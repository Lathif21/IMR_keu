/**
 * Apply `supabase/migrations` to a Neon database that has Neon Auth and the
 * Data API enabled.
 *
 *   NEON_DATABASE_URL=postgres://... npx tsx scripts/neon-migrate.ts [--bootstrap]
 *
 * The migrations stay written for Supabase, because local development and
 * `npm test` still run on the Supabase stack. Neon differs in one place only:
 * users live in `neon_auth."user"` instead of `auth.users`. `auth.uid()`,
 * `request.jwt.claims` and the `authenticated` role behave the same, so RLS
 * and every trigger are applied unchanged.
 *
 * Each file runs in its own transaction and is recorded in
 * `neon_schema_migrations`, so running the script again only applies what is
 * new. `--bootstrap` additionally applies `supabase/neon-bootstrap.sql`
 * (entities and the operational sync link), which is idempotent.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = 'supabase/migrations';
const BOOTSTRAP_FILE = 'supabase/neon-bootstrap.sql';

export function toNeon(sql: string): string {
  return sql.replace(/references\s+auth\.users\s*\(\s*id\s*\)/gi, 'references neon_auth."user"(id)');
}

async function main() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(
      'create table if not exists neon_schema_migrations (name text primary key, applied_at timestamptz not null default now())'
    );
    const { rows } = await client.query<{ name: string }>('select name from neon_schema_migrations');
    const applied = new Set(rows.map((row) => row.name));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const name of files) {
      if (applied.has(name)) {
        console.log(`skip   ${name}`);
        continue;
      }
      const sql = toNeon(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into neon_schema_migrations (name) values ($1)', [name]);
        await client.query('commit');
        console.log(`apply  ${name}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`${name}: ${(error as Error).message}`);
      }
    }

    if (process.argv.includes('--bootstrap')) {
      await client.query(readFileSync(BOOTSTRAP_FILE, 'utf8'));
      console.log(`apply  ${BOOTSTRAP_FILE}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
