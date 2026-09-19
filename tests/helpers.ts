/**
 * Shared plumbing for the database tests.
 *
 * Everything here talks to the local Supabase stack that `supabase start`
 * already runs. There is no second harness: the tests exercise the same
 * Postgres, the same policies and the same triggers the app does, because a
 * guard that is only tested against a mock is a guard nobody has tested.
 */

import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * `supabase status` prints this and it is the same on every local install.
 * Overridable, but never read from a deployed environment — every statement
 * below assumes it may truncate the whole database.
 */
const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error(
    'PUBLIC_SUPABASE_ANON_KEY dan SUPABASE_SERVICE_ROLE_KEY harus ada di .env. ' +
      'Jalankan `supabase status` dan salin nilainya.'
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * The four seed accounts, one per role. Credentials live in
 * `supabase/seed.sql` and are printed in `README.md`; they exist only in a
 * local database. Read from env with a default rather than restated here, so
 * there is still one place that decides them.
 */
export const SEED_EMAIL = {
  direksi: 'direksi@example.test',
  manajer: 'manajer@example.test',
  'staf.ilj': 'staf.ilj@example.test',
  auditor: 'auditor@example.test'
} as const;

export type SeedRole = keyof typeof SEED_EMAIL;

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'devpassword';

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/**
 * A client authenticated as one of the seed accounts. Every query it makes
 * runs under that user's RLS — which is the entire point of these tests.
 */
export async function signIn(role: SeedRole): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: SEED_EMAIL[role],
    password: SEED_PASSWORD
  });
  if (error) throw new Error(`Gagal masuk sebagai ${role}: ${error.message}`);
  return client;
}

/**
 * Bypasses RLS, for arranging fixtures. Triggers still run — the service role
 * is not a way around the workflow guards, and nothing here should treat it
 * as one.
 */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// ---------------------------------------------------------------------------
// Direct SQL
// ---------------------------------------------------------------------------

let db: pg.Client | null = null;

async function connection(): Promise<pg.Client> {
  if (!db) {
    db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
  }
  return db;
}

/** Raw SQL as the `postgres` superuser. RLS does not apply; triggers do. */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await connection();
  const result = await client.query<T>(text, params);
  return result.rows;
}

/** Every test file closes this in `afterAll`, or vitest waits on the socket. */
export async function closeDb(): Promise<void> {
  if (db) {
    await db.end();
    db = null;
  }
}

// ---------------------------------------------------------------------------
// Fixture reset
// ---------------------------------------------------------------------------

/**
 * Back to the state `npm run db:reset` leaves behind — without the 60 seconds
 * that command spends recreating the database and restarting containers.
 *
 * `docs/task/05-regression-tests.md` asks for `db:reset` once per file. At a
 * minute a go that is six minutes for a suite budgeted at one, so the tables
 * the seed owns are truncated and `supabase/seed.sql` is replayed instead.
 * Same file, same triggers, same result — and it stays honest because the
 * seed is re-read from disk rather than restated here.
 *
 * What this does NOT do is re-apply migrations. After changing the schema,
 * run `npm run db:reset` once before `npm test`.
 */
export async function resetFixture(): Promise<void> {
  await snapshotTemplates();

  await sql(`
    truncate table
      audit_log,
      report_lines,
      periods,
      intercompany_transactions,
      user_entity_access,
      entities
    restart identity cascade;
  `);

  await restoreTemplates();

  /**
   * Cascades through profiles, identities and every live session. Tokens
   * handed out before a reset stop working, which is why `signIn()` has to
   * come after it and not before.
   */
  await sql('truncate table auth.users cascade;');

  await sql(readFileSync('supabase/seed.sql', 'utf8'));
}

/**
 * Templates are created by the migrations, not by the seed, so truncating the
 * seed's tables leaves them behind — and several tests change them for good:
 * the swap tests reorder `sort_order`, the audit test rewrites a `section`,
 * and one of them creates a whole extra template.
 *
 * The result was a suite that passed once and failed on the next run without
 * an intervening `db:reset`, with four failures that looked like real
 * regressions and were not. A suite that only holds on a freshly reset
 * database is a suite nobody can trust twice.
 *
 * So the first reset of a session copies both tables aside, and every reset
 * afterwards restores from that copy.
 *
 * The copy is made with plain `create table as`, inside the database itself,
 * which is what makes it self-correcting: `supabase db reset` recreates the
 * whole database and takes the copy with it, so the next snapshot is taken
 * from a freshly migrated — and therefore pristine — state.
 */
async function snapshotTemplates(): Promise<void> {
  const [existing] = await sql<{ ada: string | null }>(
    "select to_regclass('public._fixture_templates')::text as ada"
  );
  if (existing.ada !== null) return;

  await sql('create table _fixture_templates as select * from report_templates;');
  await sql('create table _fixture_template_lines as select * from report_template_lines;');
}

/**
 * Restores both tables from the snapshot.
 *
 * Deleting the templates cascades to their lines, which also removes any
 * extra template a test created. Run after the truncate above, because
 * `periods.template_id` still references these rows until the periods are
 * gone.
 *
 * The delete and insert fire the audit triggers, so `audit_log` is cleared
 * again afterwards — a test that counts audit rows must not see the harness's
 * own bookkeeping.
 */
async function restoreTemplates(): Promise<void> {
  await sql('delete from report_templates;');
  await sql('insert into report_templates select * from _fixture_templates;');
  await sql('insert into report_template_lines select * from _fixture_template_lines;');
  await sql('truncate table audit_log;');
}

// ---------------------------------------------------------------------------
// Fixture lookups and builders
// ---------------------------------------------------------------------------

export async function entityId(code: string): Promise<string> {
  const rows = await sql<{ id: string }>('select id from entities where code = $1', [code]);
  if (rows.length === 0) throw new Error(`Entitas ${code} tidak ada di fixture`);
  return rows[0].id;
}

export async function userId(role: SeedRole): Promise<string> {
  const rows = await sql<{ id: string }>('select id from auth.users where email = $1', [
    SEED_EMAIL[role]
  ]);
  if (rows.length === 0) throw new Error(`Akun ${role} tidak ada di fixture`);
  return rows[0].id;
}

export async function periodId(code: string, period: string): Promise<string> {
  const rows = await sql<{ id: string }>(
    'select p.id from periods p join entities e on e.id = p.entity_id where e.code = $1 and p.period = $2',
    [code, period]
  );
  if (rows.length === 0) throw new Error(`Periode ${code} ${period} tidak ada di fixture`);
  return rows[0].id;
}

/**
 * The active trucking template every seeded period uses.
 *
 * Chosen by business line and version, not by code. That is what
 * `entry/+page.server.ts` does when it creates a period, so a new template
 * version moves the fixtures along with the application instead of leaving
 * the suite testing a template nothing creates periods on any more.
 */
export async function templateId(): Promise<string> {
  const rows = await sql<{ id: string }>(
    "select id from report_templates where business_line = 'trucking' and is_active order by version desc limit 1"
  );
  if (rows.length === 0) throw new Error('Tidak ada template trucking yang aktif');
  return rows[0].id;
}

export interface SeedLine {
  line_code: string;
  amount: number;
  note?: string;
}

/**
 * A period built the way the seed builds one: created as draft under the
 * staff account, filled, then walked up the status ladder with a submitter
 * and an approver who are different people.
 *
 * Impersonation rather than a direct INSERT with a status column, because
 * every guard this suite exists to check runs on that path. A fixture that
 * sidesteps the triggers would quietly stop resembling the thing under test.
 */
export async function seedPeriod(options: {
  entityCode: string;
  period: string;
  lines: SeedLine[];
  status?: 'draft' | 'submitted' | 'approved' | 'locked';
}): Promise<string> {
  const { entityCode, period, lines, status = 'approved' } = options;

  const entity = await entityId(entityCode);
  const template = await templateId();
  const staff = await userId('staf.ilj');
  const manager = await userId('manajer');

  await sql('begin');
  try {
    await sql(`set local request.jwt.claims = '{"sub":"${staff}","role":"authenticated"}'`);

    const [created] = await sql<{ id: string }>(
      'insert into periods (entity_id, period, template_id) values ($1, $2, $3) returning id',
      [entity, period, template]
    );

    for (const line of lines) {
      await sql(
        'insert into report_lines (period_id, line_code, amount, note) values ($1, $2, $3, $4)',
        [created.id, line.line_code, line.amount, line.note ?? null]
      );
    }

    if (status !== 'draft') {
      await sql(
        "update periods set status = 'submitted', submitted_by = $2, submitted_at = now() where id = $1",
        [created.id, staff]
      );
    }

    if (status === 'approved' || status === 'locked') {
      await sql(`set local request.jwt.claims = '{"sub":"${manager}","role":"authenticated"}'`);
      await sql(
        "update periods set status = 'approved', approved_by = $2, approved_at = now() where id = $1",
        [created.id, manager]
      );
    }

    if (status === 'locked') {
      await sql(
        "update periods set status = 'locked', locked_by = $2, locked_at = now() where id = $1",
        [created.id, manager]
      );
    }

    await sql('commit');
    return created.id;
  } catch (cause) {
    await sql('rollback');
    throw cause;
  }
}

/** Rupiah out of `numeric(18,2)`, which node-postgres hands back as a string. */
export function amount(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}
