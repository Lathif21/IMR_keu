/**
 * The status ladder: which transitions are legal, who may make them, and what
 * a period refuses once it has left draft.
 *
 * All of it lives in `guard_period_transition`, so these run through
 * authenticated clients rather than raw SQL — the trigger reads `auth.uid()`,
 * and a superuser session has none.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  closeDb,
  entityId,
  resetFixture,
  seedPeriod,
  signIn,
  sql,
  templateId,
  userId
} from './helpers';

let staff: SupabaseClient;
let manager: SupabaseClient;
let director: SupabaseClient;

let ilj: string;
let template: string;
let staffId: string;
let managerId: string;
let directorId: string;

/** A fresh draft period, so each test starts from a known rung. */
let nextMonth = 1;
async function freshDraft(lines = [{ line_code: 'REV_TAGIHAN', amount: 10_000_000 }]) {
  const month = String(nextMonth++).padStart(2, '0');
  return seedPeriod({
    entityCode: 'ILJ',
    period: `2027-${month}-01`,
    status: 'draft',
    lines
  });
}

beforeAll(async () => {
  await resetFixture();

  ilj = await entityId('ILJ');
  template = await templateId();
  staffId = await userId('staf.ilj');
  managerId = await userId('manajer');
  directorId = await userId('direksi');

  staff = await signIn('staf.ilj');
  manager = await signIn('manajer');
  director = await signIn('direksi');
});

afterAll(closeDb);

async function statusOf(id: string): Promise<string> {
  const [row] = await sql<{ status: string }>('select status from periods where id = $1', [id]);
  return row.status;
}

describe('transisi yang sah', () => {
  it('draft → submitted → approved → locked', async () => {
    const id = await freshDraft();

    const submitted = await staff
      .from('periods')
      .update({ status: 'submitted', submitted_by: staffId, submitted_at: new Date().toISOString() })
      .eq('id', id);
    expect(submitted.error).toBeNull();
    expect(await statusOf(id)).toBe('submitted');

    const approved = await manager
      .from('periods')
      .update({ status: 'approved', approved_by: managerId, approved_at: new Date().toISOString() })
      .eq('id', id);
    expect(approved.error).toBeNull();
    expect(await statusOf(id)).toBe('approved');

    const locked = await manager
      .from('periods')
      .update({ status: 'locked', locked_by: managerId, locked_at: new Date().toISOString() })
      .eq('id', id);
    expect(locked.error).toBeNull();
    expect(await statusOf(id)).toBe('locked');
  });

  it('penolakan mengembalikan submitted ke draft', async () => {
    const id = await freshDraft();
    await staff.from('periods').update({ status: 'submitted', submitted_by: staffId }).eq('id', id);

    const { error } = await manager
      .from('periods')
      .update({ status: 'draft', rejection_note: 'Pajak Juli belum masuk' })
      .eq('id', id);

    expect(error).toBeNull();
    expect(await statusOf(id)).toBe('draft');
  });
});

describe('transisi yang tidak sah', () => {
  it('draft tidak dapat langsung disetujui', async () => {
    const id = await freshDraft();
    const { error } = await manager
      .from('periods')
      .update({ status: 'approved', approved_by: managerId })
      .eq('id', id);

    expect(error?.message).toContain('Transisi status tidak sah');
    expect(await statusOf(id)).toBe('draft');
  });

  it('submitted tidak dapat langsung dikunci', async () => {
    const id = await freshDraft();
    await staff.from('periods').update({ status: 'submitted', submitted_by: staffId }).eq('id', id);

    const { error } = await manager
      .from('periods')
      .update({ status: 'locked', locked_by: managerId })
      .eq('id', id);

    expect(error?.message).toContain('Transisi status tidak sah');
    expect(await statusOf(id)).toBe('submitted');
  });
});

describe('pemisahan tugas', () => {
  it('pengaju tidak dapat menyetujui pekerjaannya sendiri', async () => {
    // The staff account cannot approve at all, so the test that matters is a
    // manager who submitted: same person on both sides of the same period.
    const [created] = await sql<{ id: string }>(
      'insert into periods (entity_id, period, template_id) values ($1, $2, $3) returning id',
      [ilj, '2027-11-01', template]
    );

    await manager
      .from('periods')
      .update({ status: 'submitted', submitted_by: managerId })
      .eq('id', created.id);
    expect(await statusOf(created.id)).toBe('submitted');

    const { error } = await manager
      .from('periods')
      .update({ status: 'approved', approved_by: managerId })
      .eq('id', created.id);

    expect(error?.message).toContain('Pengaju tidak dapat menyetujui');
    expect(await statusOf(created.id)).toBe('submitted');

    // Someone else can.
    const { error: byDirector } = await director
      .from('periods')
      .update({ status: 'approved', approved_by: directorId })
      .eq('id', created.id);
    expect(byDirector).toBeNull();
    expect(await statusOf(created.id)).toBe('approved');
  });

  it('approved_by harus pengguna yang sedang masuk', async () => {
    // Without this the trail could name someone who never looked at it — and
    // leaving approved_by empty used to slip past the check above entirely.
    const id = await freshDraft();
    await staff.from('periods').update({ status: 'submitted', submitted_by: staffId }).eq('id', id);

    const { error } = await manager
      .from('periods')
      .update({ status: 'approved', approved_by: directorId })
      .eq('id', id);

    expect(error?.message).toContain('approved_by harus pengguna yang sedang masuk');
    expect(await statusOf(id)).toBe('submitted');
  });

  it('staf entitas tidak dapat menyetujui', async () => {
    /**
     * Submitted by the manager on purpose. With the staff account on both
     * sides, segregation of duties refuses it first and the role check never
     * runs — the test would pass while proving the wrong thing.
     */
    const [created] = await sql<{ id: string }>(
      'insert into periods (entity_id, period, template_id) values ($1, $2, $3) returning id',
      [ilj, '2027-10-01', template]
    );
    await manager
      .from('periods')
      .update({ status: 'submitted', submitted_by: managerId })
      .eq('id', created.id);

    const { error } = await staff
      .from('periods')
      .update({ status: 'approved', approved_by: staffId })
      .eq('id', created.id);

    expect(error?.message).toContain('tidak berwenang');
    expect(await statusOf(created.id)).toBe('submitted');
  });
});

describe('catatan wajib', () => {
  it('penolakan tanpa catatan ditolak', async () => {
    const id = await freshDraft();
    await staff.from('periods').update({ status: 'submitted', submitted_by: staffId }).eq('id', id);

    const { error } = await manager.from('periods').update({ status: 'draft' }).eq('id', id);
    expect(error?.message).toContain('wajib disertai catatan');

    const blank = await manager
      .from('periods')
      .update({ status: 'draft', rejection_note: '   ' })
      .eq('id', id);
    expect(blank.error?.message).toContain('wajib disertai catatan');

    expect(await statusOf(id)).toBe('submitted');
  });

  it('membatalkan persetujuan juga wajib beralasan', async () => {
    const id = await seedPeriod({
      entityCode: 'ILJ',
      period: '2027-12-01',
      lines: [{ line_code: 'REV_TAGIHAN', amount: 5_000_000 }]
    });

    const { error } = await manager.from('periods').update({ status: 'draft' }).eq('id', id);
    expect(error?.message).toContain('wajib disertai catatan');
    expect(await statusOf(id)).toBe('approved');
  });
});

describe('membuka kunci', () => {
  it('hanya direksi', async () => {
    const id = await seedPeriod({
      entityCode: 'ILJ',
      period: '2028-01-01',
      status: 'locked',
      lines: [{ line_code: 'REV_TAGIHAN', amount: 7_000_000 }]
    });

    const byManager = await manager
      .from('periods')
      .update({ status: 'draft', rejection_note: 'koreksi angka' })
      .eq('id', id);
    expect(byManager.error?.message).toContain('Hanya direksi');
    expect(await statusOf(id)).toBe('locked');

    const byDirector = await director
      .from('periods')
      .update({ status: 'draft', rejection_note: 'koreksi angka' })
      .eq('id', id);
    expect(byDirector.error).toBeNull();
    expect(await statusOf(id)).toBe('draft');
  });

  it('tercatat di audit log', async () => {
    const rows = await sql<{ actor_id: string; action: string }>(
      `select actor_id, action from audit_log
        where table_name = 'periods'
          and new_value ->> 'rejection_note' = 'koreksi angka'
          and new_value ->> 'status' = 'draft'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(directorId);
  });
});

describe('periode terkunci', () => {
  it('menolak perubahan baris', async () => {
    const id = await seedPeriod({
      entityCode: 'ILJ',
      period: '2028-02-01',
      status: 'locked',
      lines: [{ line_code: 'REV_TAGIHAN', amount: 3_000_000 }]
    });

    const insert = await staff
      .from('report_lines')
      .insert({ period_id: id, line_code: 'OPEX_GAJI', amount: 1 });
    expect(insert.error).not.toBeNull();

    /**
     * An UPDATE is refused by the policy before the trigger ever sees it —
     * `lines_write` requires the period to be draft — so this one comes back
     * as zero rows rather than as a raised message. Both are refusals; the
     * figure not changing is what actually matters.
     */
    const update = await staff
      .from('report_lines')
      .update({ amount: 999 })
      .eq('period_id', id)
      .select();
    expect(update.data).toEqual([]);

    const [line] = await sql<{ amount: string }>(
      'select amount from report_lines where period_id = $1',
      [id]
    );
    expect(Number(line.amount)).toBe(3_000_000);
  });

  it('menolak perubahan baris bahkan lewat service role', async () => {
    // The trigger, not the policy. Service role bypasses RLS and still cannot
    // touch a line whose period has left draft (invariant 5).
    const id = await seedPeriod({
      entityCode: 'ILJ',
      period: '2028-03-01',
      lines: [{ line_code: 'REV_TAGIHAN', amount: 2_000_000 }]
    });

    await expect(
      sql("update report_lines set amount = 1 where period_id = $1", [id])
    ).rejects.toThrow(/tidak dapat diubah/);
  });
});
