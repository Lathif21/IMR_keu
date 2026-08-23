/**
 * The triggers that stop a well-formed request from producing a wrong report:
 * line codes that are not in the template, periods born approved, and an
 * audit trail that cannot be rewritten.
 *
 * These are the failures with no error message anywhere — a mistyped line
 * code leaves the statement balanced and wrong — so each one is checked from
 * the privileged side as well. A guard that only holds against the app layer
 * is not a guard.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  closeDb,
  entityId,
  resetFixture,
  seedPeriod,
  serviceClient,
  signIn,
  sql,
  templateId,
  userId
} from './helpers';

let staff: SupabaseClient;
let service: SupabaseClient;

let ilj: string;
let template: string;
let staffId: string;
let draft: string;

beforeAll(async () => {
  await resetFixture();

  ilj = await entityId('ILJ');
  template = await templateId();
  staffId = await userId('staf.ilj');

  draft = await seedPeriod({
    entityCode: 'ILJ',
    period: '2029-01-01',
    status: 'draft',
    lines: [{ line_code: 'REV_TAGIHAN', amount: 4_000_000 }]
  });

  staff = await signIn('staf.ilj');
  service = serviceClient();
});

afterAll(closeDb);

describe('guard_line_code_in_template', () => {
  /**
   * `v_period_pnl` sums through a join to `report_template_lines`. A code
   * that is not in the template joins to a NULL section, so it lands in none
   * of the `filter (where section = ...)` buckets: the amount disappears from
   * revenue, from costs and from net profit, and the statement still adds up.
   */
  it('menolak line_code yang tidak ada di template', async () => {
    const { error } = await staff
      .from('report_lines')
      .insert({ period_id: draft, line_code: 'REV_TYPO', amount: 50_000_000 });

    expect(error?.message).toContain('tidak ada');
    expect(await sql("select 1 from report_lines where line_code = 'REV_TYPO'")).toEqual([]);
  });

  it('service role tidak punya jalur tulis sama sekali', async () => {
    /**
     * Not the trigger — the grant. `BAGIAN 12` hands write access to
     * `authenticated` only, and a table created by a migration inherits
     * nothing, so `service_role` is refused before any policy or trigger is
     * consulted. Worth pinning down: it bounds what a leaked service key can
     * do to the books.
     */
    const { error } = await service
      .from('report_lines')
      .insert({ period_id: draft, line_code: 'REV_TYPO', amount: 50_000_000 });

    expect(error?.message).toContain('permission denied');
    expect(await sql("select 1 from report_lines where line_code = 'REV_TYPO'")).toEqual([]);
  });

  it('menolaknya juga lewat SQL langsung', async () => {
    // Supabase Studio and psql both arrive here. The trigger is the only
    // thing standing in the way, and it has to hold for all three.
    await expect(
      sql("insert into report_lines (period_id, line_code, amount) values ($1, 'REV_TYPO', 1)", [
        draft
      ])
    ).rejects.toThrow(/tidak ada/);
  });

  it('menolak line_code yang dinonaktifkan di template', async () => {
    await sql(
      "update report_template_lines set is_active = false where template_id = $1 and line_code = 'OPEX_SEWA'",
      [template]
    );

    try {
      const { error } = await staff
        .from('report_lines')
        .insert({ period_id: draft, line_code: 'OPEX_SEWA', amount: 1_500_000 });
      expect(error).not.toBeNull();
    } finally {
      await sql(
        "update report_template_lines set is_active = true where template_id = $1 and line_code = 'OPEX_SEWA'",
        [template]
      );
    }
  });

  it('menerima line_code yang ada', async () => {
    const { error } = await staff
      .from('report_lines')
      .insert({ period_id: draft, line_code: 'OPEX_GAJI', amount: 9_000_000 });
    expect(error).toBeNull();
  });
});

describe('guard_period_insert', () => {
  it('periode baru selalu lahir draft, meski dikirim approved', async () => {
    const { error } = await staff
      .from('periods')
      .insert({
        entity_id: ilj,
        period: '2029-02-01',
        template_id: template,
        status: 'approved'
      });

    /**
     * Refused outright rather than quietly downgraded. A period that arrives
     * approved has skipped the whole workflow, and the dashboard would count
     * it as an entity that has reported while holding no lines at all.
     */
    expect(error?.message).toContain('harus berstatus draft');
    expect(await sql("select 1 from periods where period = '2029-02-01'")).toEqual([]);
  });

  it('kolom jejak alur kerja pada INSERT ditimpa null', async () => {
    const { error } = await staff.from('periods').insert({
      entity_id: ilj,
      period: '2029-03-01',
      template_id: template,
      submitted_by: staffId,
      submitted_at: new Date().toISOString(),
      approved_by: staffId,
      approved_at: new Date().toISOString(),
      locked_by: staffId
    });
    expect(error).toBeNull();

    const [row] = await sql<{
      status: string;
      submitted_by: string | null;
      submitted_at: string | null;
      approved_by: string | null;
      locked_by: string | null;
      created_by: string | null;
    }>(
      `select status, submitted_by, submitted_at, approved_by, locked_by, created_by
         from periods where period = '2029-03-01'`
    );

    expect(row.status).toBe('draft');
    expect(row.submitted_by).toBeNull();
    expect(row.submitted_at).toBeNull();
    expect(row.approved_by).toBeNull();
    expect(row.locked_by).toBeNull();
    // created_by is not taken from the request either — it comes from the JWT.
    expect(row.created_by).toBe(staffId);
  });
});

describe('audit_log', () => {
  it('menolak UPDATE', async () => {
    await expect(
      sql('update audit_log set actor_id = null where id = (select min(id) from audit_log)')
    ).rejects.toThrow(/append-only/);
  });

  it('menolak DELETE', async () => {
    await expect(
      sql('delete from audit_log where id = (select min(id) from audit_log)')
    ).rejects.toThrow(/append-only/);
  });

  it('tidak dapat ditulis dari aplikasi sama sekali', async () => {
    // Invariant 4: the trail is written by triggers. There is no INSERT grant
    // for `authenticated`, so there is no code path at all.
    const { error } = await staff
      .from('audit_log')
      .insert({ table_name: 'periods', record_pk: 'x', action: 'INSERT' });
    expect(error).not.toBeNull();
  });

  it('mencatat setiap perubahan dengan actor_id terisi', async () => {
    const before = await sql<{ count: string }>('select count(*) from audit_log');

    const { error } = await staff
      .from('report_lines')
      .update({ amount: 4_500_000 })
      .eq('period_id', draft)
      .eq('line_code', 'REV_TAGIHAN');
    expect(error).toBeNull();

    const rows = await sql<{ actor_id: string; action: string; old_value: Record<string, unknown> }>(
      `select actor_id, action, old_value from audit_log
        where table_name = 'report_lines'
          and record_pk = (select id::text from report_lines
                            where period_id = $1 and line_code = 'REV_TAGIHAN')
          and action = 'UPDATE'`,
      [draft]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(staffId);
    expect(Number(rows[0].old_value.amount)).toBe(4_000_000);

    const after = await sql<{ count: string }>('select count(*) from audit_log');
    expect(Number(after[0].count)).toBeGreaterThan(Number(before[0].count));
  });

  it('mencatat tabel berkunci komposit dengan record_pk terisi', async () => {
    // user_entity_access has no `id` column. An earlier version of audit_row()
    // read only 'id', which made every write to this table impossible —
    // audit_log.record_pk is NOT NULL.
    const director = await signIn('direksi');
    const amdk = await entityId('AMDK');

    const { error } = await director
      .from('user_entity_access')
      .insert({ user_id: staffId, entity_id: amdk });
    expect(error).toBeNull();

    const rows = await sql<{ record_pk: string }>(
      "select record_pk from audit_log where table_name = 'user_entity_access' and action = 'INSERT'"
    );

    // Two: the seed's own grant, and the one above. Neither may have a null
    // record_pk, which is the column that made this table unwritable before
    // audit_row() learned to read a composite key out of the catalog.
    expect(rows.map((row) => row.record_pk)).toContain(`${staffId}:${amdk}`);
    expect(rows.every((row) => row.record_pk.includes(':'))).toBe(true);
  });
});
