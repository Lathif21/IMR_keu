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
let director: SupabaseClient;
let manager: SupabaseClient;

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
  director = await signIn('direksi');
  manager = await signIn('manajer');
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

// ---------------------------------------------------------------------------
// Fase 3 prasyarat — migrations/20250103000000_admin_prerequisites.sql
// ---------------------------------------------------------------------------

describe('basis pelaporan hanya berubah dengan alasan tertulis', () => {
  /**
   * Not a UI rule. RLS lets a director update `entities` by any route, so
   * enforcing "must have a reason" in the screen alone would leave PostgREST
   * wide open — invariant 1. The trigger is the boundary; the RPC is the only
   * door through it.
   */
  it('menolak update kolom secara langsung, bahkan oleh direksi', async () => {
    const { error } = await director
      .from('entities')
      .update({ reporting_basis: 'cash' })
      .eq('id', ilj);

    expect(error?.message).toContain('pencatatan kebijakan beralasan');

    const [row] = await sql<{ reporting_basis: string }>(
      'select reporting_basis from entities where id = $1',
      [ilj]
    );
    expect(row.reporting_basis).toBe('unknown');
  });

  it('RPC menulis kebijakan dan nilai operasionalnya sekaligus', async () => {
    const { error } = await director.rpc('set_entity_reporting_basis', {
      p_entity_id: ilj,
      p_basis: 'cash',
      p_presentation: 'gross',
      p_rationale: 'Konfirmasi akuntan: ILJ mencatat saat kas diterima.',
      p_effective_from: '2025-01-01'
    });
    expect(error).toBeNull();

    const [entity] = await sql<{ reporting_basis: string; revenue_presentation: string }>(
      'select reporting_basis, revenue_presentation from entities where id = $1',
      [ilj]
    );
    expect(entity.reporting_basis).toBe('cash');
    expect(entity.revenue_presentation).toBe('gross');

    // Two rows, because the two columns are two separate decisions that
    // happen to be taken together.
    const policies = await sql<{ policy_key: string; chosen_value: string; decided_by: string }>(
      `select policy_key, chosen_value, decided_by from accounting_policies
        where entity_id = $1 order by policy_key`,
      [ilj]
    );
    expect(policies.map((p) => p.policy_key)).toEqual([
      'reporting_basis',
      'revenue_presentation'
    ]);
    expect(policies.map((p) => p.chosen_value)).toEqual(['cash', 'gross']);

    // The name comes from the caller's profile, never from a parameter — a
    // caller must not be able to sign someone else's name to a decision.
    expect(new Set(policies.map((p) => p.decided_by))).toEqual(new Set(['Akun Dev A']));
  });

  it('menolak pemanggil yang bukan direksi', async () => {
    const amdk = await entityId('AMDK');
    const { error } = await manager.rpc('set_entity_reporting_basis', {
      p_entity_id: amdk,
      p_basis: 'accrual',
      p_presentation: 'net',
      p_rationale: 'Alasan yang cukup panjang untuk lolos pemeriksaan.',
      p_effective_from: '2025-01-01'
    });

    expect(error?.message).toContain('Hanya direksi');
    const [row] = await sql<{ reporting_basis: string }>(
      'select reporting_basis from entities where id = $1',
      [amdk]
    );
    expect(row.reporting_basis).toBe('unknown');
  });

  it('menolak alasan kosong, termasuk yang hanya spasi', async () => {
    const amdk = await entityId('AMDK');
    const { error } = await director.rpc('set_entity_reporting_basis', {
      p_entity_id: amdk,
      p_basis: 'accrual',
      p_presentation: 'net',
      p_rationale: '   ',
      p_effective_from: '2025-01-01'
    });

    expect(error?.message).toContain('wajib disertai alasan');
  });

  it('menolak tanpa tanggal berlaku, dengan pesan yang terbaca', async () => {
    // accounting_policies has a check constraint for this. Caught inside the
    // function so the message names the field rather than the constraint.
    const amdk = await entityId('AMDK');
    const { error } = await director.rpc('set_entity_reporting_basis', {
      p_entity_id: amdk,
      p_basis: 'accrual',
      p_presentation: 'net',
      p_rationale: 'Alasan yang cukup panjang untuk lolos pemeriksaan.',
      p_effective_from: null
    });

    expect(error?.message).toContain('tanggal mulai berlaku');
  });

  it('menolak penetapan kedua pada tanggal berlaku yang sama', async () => {
    const { error } = await director.rpc('set_entity_reporting_basis', {
      p_entity_id: ilj,
      p_basis: 'accrual',
      p_presentation: 'net',
      p_rationale: 'Percobaan menimpa penetapan yang sudah ada.',
      p_effective_from: '2025-01-01'
    });

    expect(error?.message).toContain('Sudah ada penetapan basis');

    // The first decision stands.
    const [row] = await sql<{ reporting_basis: string }>(
      'select reporting_basis from entities where id = $1',
      [ilj]
    );
    expect(row.reporting_basis).toBe('cash');
  });
});

describe('sort_order deferrable', () => {
  it('menukar dua baris dalam satu transaksi', async () => {
    const before = await sql<{ line_code: string; sort_order: number }>(
      `select line_code, sort_order from report_template_lines
        where template_id = $1 and line_code in ('REV_TAGIHAN','REV_LAINNYA')
        order by sort_order`,
      [template]
    );
    expect(before.map((r) => r.line_code)).toEqual(['REV_TAGIHAN', 'REV_LAINNYA']);

    /**
     * Both rows briefly hold the same sort_order between these two
     * statements. A non-deferrable unique constraint refuses exactly there,
     * even though the end state is valid — which is why migration
     * 20250103000000 made it `deferrable initially deferred`.
     */
    await sql('begin');
    await sql(
      "update report_template_lines set sort_order = 20 where template_id = $1 and line_code = 'REV_TAGIHAN'",
      [template]
    );
    await sql(
      "update report_template_lines set sort_order = 10 where template_id = $1 and line_code = 'REV_LAINNYA'",
      [template]
    );
    await sql('commit');

    const after = await sql<{ line_code: string; sort_order: number }>(
      `select line_code, sort_order from report_template_lines
        where template_id = $1 and line_code in ('REV_TAGIHAN','REV_LAINNYA')
        order by sort_order`,
      [template]
    );
    expect(after.map((r) => r.line_code)).toEqual(['REV_LAINNYA', 'REV_TAGIHAN']);
  });

  it('menukar lewat RPC, jalur yang dipakai layar template', async () => {
    /**
     * PostgREST gives every request its own transaction and cannot be asked
     * to span two, so two sequential updates would each commit — and the
     * first commit already holds a duplicate. `swap_template_line_order`
     * supplies the single transaction the deferred constraint needs.
     */
    const rows = await sql<{ id: string; line_code: string }>(
      `select id, line_code from report_template_lines
        where template_id = $1 and line_code in ('OPEX_GAJI','OPEX_SEWA')
        order by sort_order`,
      [template]
    );
    expect(rows.map((r) => r.line_code)).toEqual(['OPEX_GAJI', 'OPEX_SEWA']);

    const { error } = await director.rpc('swap_template_line_order', {
      p_a: rows[0].id,
      p_b: rows[1].id
    });
    expect(error).toBeNull();

    const after = await sql<{ line_code: string }>(
      `select line_code from report_template_lines
        where template_id = $1 and line_code in ('OPEX_GAJI','OPEX_SEWA')
        order by sort_order`,
      [template]
    );
    expect(after.map((r) => r.line_code)).toEqual(['OPEX_SEWA', 'OPEX_GAJI']);
  });

  it('menolak menukar baris dari dua template berbeda', async () => {
    const [other] = await sql<{ id: string }>(
      `insert into report_templates (code, name, business_line, version)
       values ('UJI_SWAP', 'Template uji', 'uji', 1) returning id`
    );
    const [otherLine] = await sql<{ id: string }>(
      `insert into report_template_lines (template_id, line_code, line_label, section, sort_order)
       values ($1, 'REV_UJI', 'Uji', 'revenue', 10) returning id`,
      [other.id]
    );
    const [mine] = await sql<{ id: string }>(
      "select id from report_template_lines where template_id = $1 and line_code = 'OPEX_GAJI'",
      [template]
    );

    const { error } = await director.rpc('swap_template_line_order', {
      p_a: mine.id,
      p_b: otherLine.id
    });
    expect(error?.message).toContain('template yang sama');
  });

  it('menolak pemanggil yang tidak berhak menulis template', async () => {
    // security invoker: the RPC does not lend its own rights to anyone. RLS
    // filters the UPDATE to zero rows, so nothing moves.
    const rows = await sql<{ id: string; line_code: string }>(
      `select id, line_code from report_template_lines
        where template_id = $1 and line_code in ('OPEX_GAJI','OPEX_SEWA')
        order by sort_order`,
      [template]
    );

    await staff.rpc('swap_template_line_order', { p_a: rows[0].id, p_b: rows[1].id });

    const after = await sql<{ line_code: string }>(
      `select line_code from report_template_lines
        where template_id = $1 and line_code in ('OPEX_GAJI','OPEX_SEWA')
        order by sort_order`,
      [template]
    );
    expect(after.map((r) => r.line_code)).toEqual(rows.map((r) => r.line_code));
  });
});

describe('audit untuk tabel yang punya layar admin', () => {
  it('mencatat perubahan peran', async () => {
    // Without this trigger, promoting someone to direksi left no trace at all.
    const { error } = await director
      .from('profiles')
      .update({ role: 'auditor' })
      .eq('id', staffId);
    expect(error).toBeNull();

    const rows = await sql<{ actor_id: string; old_role: string; new_role: string }>(
      `select actor_id,
              old_value ->> 'role' as old_role,
              new_value ->> 'role' as new_role
         from audit_log
        where table_name = 'profiles' and action = 'UPDATE' and record_pk = $1`,
      [staffId]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].old_role).toBe('staf_entitas');
    expect(rows[0].new_role).toBe('auditor');
    expect(rows[0].actor_id).toBe(await userId('direksi'));
  });

  it('mencatat perubahan section sebuah baris template', async () => {
    /**
     * The change this exists to catch: `section` decides which bucket
     * `v_period_pnl` sums a figure into, for every period that ever used the
     * template — including locked ones. Gross profit across the whole history
     * moves, and nothing raises.
     */
    const { error } = await director
      .from('report_template_lines')
      .update({ section: 'opex' })
      .eq('template_id', template)
      .eq('line_code', 'COGS_TERPAL');
    expect(error).toBeNull();

    const rows = await sql<{ old_section: string; new_section: string; actor_id: string }>(
      `select old_value ->> 'section' as old_section,
              new_value ->> 'section' as new_section,
              actor_id
         from audit_log
        where table_name = 'report_template_lines' and action = 'UPDATE'
          and old_value ->> 'line_code' = 'COGS_TERPAL'`
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].old_section).toBe('cogs');
    expect(rows[0].new_section).toBe('opex');
    expect(rows[0].actor_id).toBe(await userId('direksi'));
  });

  it('mencatat perubahan template itu sendiri', async () => {
    const { error } = await director
      .from('report_templates')
      .update({ name: 'Laporan Laba Rugi — Jasa Angkutan (v1)' })
      .eq('id', template);
    expect(error).toBeNull();

    const rows = await sql(
      "select 1 from audit_log where table_name = 'report_templates' and action = 'UPDATE'"
    );
    expect(rows).toHaveLength(1);
  });
});
