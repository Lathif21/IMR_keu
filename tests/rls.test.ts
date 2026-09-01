/**
 * Who sees what.
 *
 * An RLS refusal on a read is not an error — it is an empty result. So these
 * assert row counts, never a thrown exception: a test that expects a throw
 * would pass just as happily against a table that does not exist.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  closeDb,
  entityId,
  periodId,
  resetFixture,
  seedPeriod,
  signIn,
  sql,
  userId,
  type SeedRole
} from './helpers';

let staff: SupabaseClient;
let auditor: SupabaseClient;
let manager: SupabaseClient;

let iljId: string;
let tambangId: string;
let tambangPeriod: string;
let iljDraft: string;

beforeAll(async () => {
  await resetFixture();

  iljId = await entityId('ILJ');
  tambangId = await entityId('TAMBANG');
  tambangPeriod = await periodId('TAMBANG', '2025-07-01');

  // A draft period, so "the auditor cannot write" is tested against a row
  // that is otherwise writable rather than one the workflow already froze.
  iljDraft = await seedPeriod({
    entityCode: 'ILJ',
    period: '2025-08-01',
    status: 'draft',
    lines: [{ line_code: 'REV_TAGIHAN', amount: 1_000_000 }]
  });

  staff = await signIn('staf.ilj');
  auditor = await signIn('auditor');
  manager = await signIn('manajer');
});

afterAll(closeDb);

describe('staf entitas', () => {
  it('hanya melihat entitasnya sendiri', async () => {
    const { data } = await staff.from('entities').select('code');
    expect(data?.map((row) => row.code)).toEqual(['ILJ']);
  });

  it('tidak dapat membaca periods entitas lain', async () => {
    const { data, error } = await staff.from('periods').select('id').eq('entity_id', tambangId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('tidak dapat membaca report_lines entitas lain lewat period_id', async () => {
    // The period id is guessable and the caller supplies it directly, so the
    // policy on report_lines has to check the parent period itself. It does
    // not inherit the refusal from the query above.
    const { data, error } = await staff
      .from('report_lines')
      .select('line_code, amount')
      .eq('period_id', tambangPeriod);

    expect(error).toBeNull();
    expect(data).toEqual([]);

    // The rows are really there — this is a refusal, not an empty table.
    const actual = await sql('select 1 from report_lines where period_id = $1', [tambangPeriod]);
    expect(actual.length).toBeGreaterThan(0);
  });

  it('tidak dapat membaca v_period_pnl entitas lain', async () => {
    // security_invoker = on: the view narrows with the caller, or it becomes
    // the way around every policy underneath it.
    const { data } = await staff.from('v_period_pnl').select('entity_code');
    expect([...new Set(data?.map((row) => row.entity_code))]).toEqual(['ILJ']);
  });

  it('tidak dapat membaca registry antar-perusahaan', async () => {
    await sql(
      `insert into intercompany_transactions
         (period, seller_entity_id, buyer_entity_id, amount, description)
       values ('2025-07-01', $1, $2, 5000000, 'uji isolasi')`,
      [iljId, tambangId]
    );

    const { data: staffRows } = await staff.from('intercompany_transactions').select('id');
    expect(staffRows).toEqual([]);

    // Group-level roles do see it, so the empty result above is the policy
    // and not an empty table.
    const { data: managerRows } = await manager.from('intercompany_transactions').select('id');
    expect(managerRows).toHaveLength(1);
  });
});

describe('auditor', () => {
  it('membaca seluruh entitas', async () => {
    const { data } = await auditor.from('entities').select('code');
    expect(data?.map((row) => row.code).sort()).toEqual(['AMDK', 'GARAM', 'ILJ', 'TAMBANG']);
  });

  it('membaca seluruh periode, termasuk yang belum disetujui', async () => {
    const { data } = await auditor.from('v_period_pnl').select('entity_code, status');
    expect(data?.some((row) => row.entity_code === 'AMDK' && row.status === 'submitted')).toBe(true);
  });

  it('tidak dapat menulis baris laporan', async () => {
    const { error } = await auditor
      .from('report_lines')
      .insert({ period_id: iljDraft, line_code: 'OPEX_GAJI', amount: 1 });

    expect(error).not.toBeNull();

    const rows = await sql(
      "select 1 from report_lines where period_id = $1 and line_code = 'OPEX_GAJI'",
      [iljDraft]
    );
    expect(rows).toEqual([]);
  });

  it('tidak dapat mengubah status periode', async () => {
    /**
     * An UPDATE the USING clause filters out matches zero rows, and zero rows
     * updated is not an error. The refusal shows up as nothing happening —
     * which is why the row is read back rather than the error inspected.
     */
    const { data, error } = await auditor
      .from('periods')
      .update({ status: 'submitted' })
      .eq('id', iljDraft)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const [row] = await sql<{ status: string }>('select status from periods where id = $1', [
      iljDraft
    ]);
    expect(row.status).toBe('draft');
  });

  it('tidak dapat membuat entitas', async () => {
    const { error } = await auditor
      .from('entities')
      .insert({ code: 'PALSU', legal_name: 'PT Tidak Ada', business_line: 'trucking' });

    expect(error).not.toBeNull();
    expect(await sql("select 1 from entities where code = 'PALSU'")).toEqual([]);
  });
});

describe('profil nonaktif', () => {
  it('tidak mendapat apa pun, karena current_user_role() mengembalikan NULL', async () => {
    const staffId = await userId('staf.ilj');
    await sql('update profiles set is_active = false where id = $1', [staffId]);

    try {
      // A fresh sign-in: the account still authenticates. Authentication and
      // authorization are different things, and only the second one is gone.
      const revoked = await signIn('staf.ilj');

      const [{ data: entities }, { data: periods }, { data: lines }] = await Promise.all([
        revoked.from('entities').select('code'),
        revoked.from('periods').select('id'),
        revoked.from('report_lines').select('line_code')
      ]);

      expect(entities).toEqual([]);
      expect(periods).toEqual([]);
      expect(lines).toEqual([]);

      /**
       * And it cannot write either. Until migration
       * 20250102000000_revoke_inactive_profiles.sql, this insert succeeded:
       * has_entity_access() read `user_entity_access` without ever checking
       * whether the profile behind it was still active, so deactivating an
       * account revoked nothing at all for entity staff.
       */
      const { error: writeError } = await revoked
        .from('report_lines')
        .insert({ period_id: iljDraft, line_code: 'OPEX_SEWA', amount: 1 });

      expect(writeError).not.toBeNull();
      expect(
        await sql("select 1 from report_lines where period_id = $1 and line_code = 'OPEX_SEWA'", [
          iljDraft
        ])
      ).toEqual([]);
    } finally {
      await sql('update profiles set is_active = true where id = $1', [staffId]);
    }
  });
});

/**
 * Migration 20250104000000_scope_manager_auditor.sql.
 *
 * Before it, `can_read_all_entities()` was true for these two roles, so
 * `has_entity_access()` short-circuited and never read `user_entity_access` —
 * revoking a row changed nothing. That is exactly what these assert against:
 * each one revokes a single assignment and reads back.
 *
 * The revoke is done with `sql()` rather than through the client on purpose.
 * Only direksi may write `user_entity_access`, and the point under test is the
 * read scope, not who may grant.
 */
describe('cakupan entitas manajer dan auditor', () => {
  /** Restores the assignment however the assertion ends. */
  async function withoutAccess(role: SeedRole, entity: string, body: () => Promise<void>) {
    const uid = await userId(role);
    const eid = await entityId(entity);
    await sql('delete from user_entity_access where user_id = $1 and entity_id = $2', [uid, eid]);
    try {
      await body();
    } finally {
      await sql(
        'insert into user_entity_access (user_id, entity_id) values ($1, $2) ' +
          'on conflict do nothing',
        [uid, eid]
      );
    }
  }

  it('manajer kehilangan entitas yang penugasannya dicabut', async () => {
    await withoutAccess('manajer', 'TAMBANG', async () => {
      const scoped = await signIn('manajer');

      const { data: entities } = await scoped.from('entities').select('code');
      expect(entities?.map((row) => row.code).sort()).toEqual(['AMDK', 'GARAM', 'ILJ']);

      // And the scope reaches through to the rows, not just the entity list.
      const { data: pnl } = await scoped.from('v_period_pnl').select('entity_code');
      expect(pnl?.some((row) => row.entity_code === 'TAMBANG')).toBe(false);
    });
  });

  it('manajer tidak dapat menyetujui periode entitas yang bukan miliknya', async () => {
    await withoutAccess('manajer', 'TAMBANG', async () => {
      const scoped = await signIn('manajer');

      /**
       * `can_approve()` is still true for this account — the role did not
       * change. What stops the write is `periods_update`'s entity scope, and
       * a USING clause that filters the row out updates zero rows without
       * raising, so the row is read back rather than the error inspected.
       */
      const [before] = await sql<{ status: string }>('select status from periods where id = $1', [
        tambangPeriod
      ]);

      const { data, error } = await scoped
        .from('periods')
        .update({ status: 'draft' })
        .eq('id', tambangPeriod)
        .select();

      expect(error).toBeNull();
      expect(data).toEqual([]);

      // Compared against what it was, not against a literal: the fixture owns
      // this period's status, and asserting a specific value here would make
      // the test fail the day the fixture moves rather than the day the scope
      // breaks.
      const [after] = await sql<{ status: string }>('select status from periods where id = $1', [
        tambangPeriod
      ]);
      expect(after.status).toBe(before.status);
    });
  });

  it('auditor kehilangan entitas yang penugasannya dicabut', async () => {
    await withoutAccess('auditor', 'AMDK', async () => {
      const scoped = await signIn('auditor');

      const { data } = await scoped.from('entities').select('code');
      expect(data?.map((row) => row.code).sort()).toEqual(['GARAM', 'ILJ', 'TAMBANG']);
    });
  });

  /**
   * The other half of the migration. These tables have no `entity_id` to
   * narrow, so they moved to `can_read_group_data()`; narrowing them along
   * with the entity scope would have taken the approval queue's submitter
   * names from the manajer and the audit trail from the auditor.
   */
  it('tetap membaca data tingkat grup meski tanpa satu pun entitas', async () => {
    const uid = await userId('manajer');
    await sql('delete from user_entity_access where user_id = $1', [uid]);
    try {
      const scoped = await signIn('manajer');

      const { data: entities } = await scoped.from('entities').select('code');
      expect(entities).toEqual([]);

      // Names of everyone, so the approval queue can say who submitted.
      const { data: profiles } = await scoped.from('profiles').select('id');
      expect((profiles ?? []).length).toBeGreaterThan(1);

      const { error: auditError } = await scoped.from('audit_log').select('id').limit(1);
      expect(auditError).toBeNull();

      const { error: icError } = await scoped
        .from('intercompany_transactions')
        .select('id')
        .limit(1);
      expect(icError).toBeNull();
    } finally {
      await sql(
        'insert into user_entity_access (user_id, entity_id) ' +
          'select $1, id from entities on conflict do nothing',
        [uid]
      );
    }
  });

  it('staf entitas tidak ikut terbawa: data grup tetap tertutup untuknya', async () => {
    const { data: profiles } = await staff.from('profiles').select('id');
    expect(profiles?.length).toBe(1);

    const { data: audit } = await staff.from('audit_log').select('id').limit(1);
    expect(audit).toEqual([]);
  });
});
