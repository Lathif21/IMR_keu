/**
 * `src/lib/period-range.ts`: rentang waktu dasbor dan penjumlahannya.
 * Tanpa database.
 *
 * Yang dijaga: rentang yang salah baca, pembanding yang salah label (MoM
 * yang tertulis YoY), dan rentang yang terlihat lengkap padahal sebagian
 * bulannya tidak pernah dilaporkan.
 */

import { describe, expect, it } from 'vitest';
import type { GroupConsolidated, PeriodCompleteness, PeriodPnl } from '$lib/domain';
import {
  MAX_CUSTOM_MONTHS,
  aggregateConsolidated,
  comparisonTag,
  entityTotals,
  monthsBetween,
  previousRange,
  rangeCompleteness,
  rangeLabel,
  resolveRange,
  sameCoverage,
  sumAmounts,
  type PeriodRange
} from '$lib/period-range';

const q = (s: string) => new URLSearchParams(s);
const NEWEST = '2026-09-01';
const TODAY = '2026-10-01';

describe('resolveRange', () => {
  it('bulanan dari ?periode=, dalam bentuk YYYY-MM maupun YYYY-MM-01', () => {
    expect(resolveRange(q('mode=bulanan&periode=2026-07'), NEWEST, TODAY)).toEqual({
      mode: 'bulanan', from: '2026-07-01', to: '2026-07-01'
    });
    expect(resolveRange(q('periode=2026-07-01'), NEWEST, TODAY).from).toBe('2026-07-01');
  });

  it('tanpa parameter atau dengan nilai rusak jatuh ke periode terbaru', () => {
    expect(resolveRange(q(''), NEWEST, TODAY)).toEqual({ mode: 'bulanan', from: NEWEST, to: NEWEST });
    expect(resolveRange(q('periode=2026-13'), NEWEST, TODAY).from).toBe(NEWEST);
    expect(resolveRange(q('mode=tahunan&tahun=abc'), NEWEST, TODAY).from).toBe('2026-01-01');
  });

  it('tahunan penuh untuk tahun yang sudah lewat', () => {
    expect(resolveRange(q('mode=tahunan&tahun=2025'), NEWEST, TODAY)).toEqual({
      mode: 'tahunan', from: '2025-01-01', to: '2025-12-01'
    });
  });

  /** Bulan yang belum terjadi tidak boleh dihitung sebagai "belum lapor". */
  it('tahun berjalan dipotong sampai bulan ini', () => {
    expect(resolveRange(q('mode=tahunan&tahun=2026'), NEWEST, TODAY).to).toBe('2026-10-01');
  });

  it('custom dibalik kalau dari > sampai, dan dibatasi panjangnya', () => {
    expect(resolveRange(q('mode=custom&dari=2026-06&sampai=2026-01'), NEWEST, TODAY)).toEqual({
      mode: 'custom', from: '2026-01-01', to: '2026-06-01'
    });
    const panjang = resolveRange(q('mode=custom&dari=2000-01&sampai=2026-06'), NEWEST, TODAY);
    expect(monthsBetween(panjang.from, panjang.to)).toHaveLength(MAX_CUSTOM_MONTHS);
  });
});

describe('previousRange dan label', () => {
  it('bulanan → bulan sebelumnya, melewati pergantian tahun', () => {
    const r: PeriodRange = { mode: 'bulanan', from: '2026-01-01', to: '2026-01-01' };
    expect(previousRange(r)).toEqual({ mode: 'bulanan', from: '2025-12-01', to: '2025-12-01' });
  });

  it('tahunan → bulan yang sama setahun sebelumnya', () => {
    const r: PeriodRange = { mode: 'tahunan', from: '2026-01-01', to: '2026-10-01' };
    expect(previousRange(r)).toEqual({ mode: 'tahunan', from: '2025-01-01', to: '2025-10-01' });
  });

  it('custom → rentang sepanjang itu tepat sebelumnya', () => {
    const r: PeriodRange = { mode: 'custom', from: '2026-02-01', to: '2026-04-01' };
    expect(previousRange(r)).toEqual({ mode: 'custom', from: '2025-11-01', to: '2026-01-01' });
  });

  it('label sesuai rentang', () => {
    expect(rangeLabel({ mode: 'bulanan', from: '2026-09-01', to: '2026-09-01' })).toBe('September 2026');
    expect(rangeLabel({ mode: 'tahunan', from: '2025-01-01', to: '2025-12-01' })).toBe('2025');
    expect(rangeLabel({ mode: 'tahunan', from: '2026-01-01', to: '2026-10-01' })).toBe('2026 (Januari – Oktober)');
    expect(rangeLabel({ mode: 'custom', from: '2026-01-01', to: '2026-06-01' })).toBe('Januari – Juni 2026');
    expect(rangeLabel({ mode: 'custom', from: '2025-11-01', to: '2026-02-01' })).toBe('November 2025 – Februari 2026');
  });

  /** Prototipe melabeli MoM sebagai YoY. */
  it('penanda perbandingan tidak tertukar', () => {
    expect(comparisonTag('bulanan')).toBe('MoM');
    expect(comparisonTag('tahunan')).toBe('YoY');
    expect(comparisonTag('custom')).toBe('vs. sebelumnya');
  });
});

describe('sumAmounts', () => {
  it('menjumlah tepat ke sen, campuran string dan number', () => {
    expect(sumAmounts(['200444999.99', 0.01, '1897.50'])).toBe('200446897.50');
  });

  it('null bila tidak ada nilai — beda dari nol', () => {
    expect(sumAmounts([])).toBeNull();
    expect(sumAmounts([null, undefined])).toBeNull();
    expect(sumAmounts(['0'])).toBe('0.00');
  });

  it('nilai negatif', () => {
    expect(sumAmounts(['-1500.25', '1000'])).toBe('-500.25');
  });
});

const consolidated = (period: string, revenue: string, net: string): GroupConsolidated => ({
  period,
  revenue_sum: revenue,
  elimination: '0',
  revenue_consolidated: revenue,
  cogs_sum: '0',
  opex_sum: '0',
  net_profit_consolidated: net,
  is_complete: true,
  missing_entities: null
});

describe('aggregateConsolidated', () => {
  it('menjumlahkan semua bulan dalam rentang', () => {
    const hasil = aggregateConsolidated([
      consolidated('2026-01-01', '1000000.50', '-200'),
      consolidated('2026-02-01', '2000000', '300.25')
    ]);
    expect(hasil?.revenue_consolidated).toBe('3000000.50');
    expect(hasil?.net_profit_consolidated).toBe('100.25');
  });

  it('null bila tak satu bulan pun punya angka disetujui', () => {
    expect(aggregateConsolidated([])).toBeNull();
  });
});

const completeness = (period: string, reported: number, missing: string[]): PeriodCompleteness => ({
  period,
  expected_entities: 2,
  reported_entities: reported,
  is_complete: missing.length === 0,
  missing_entities: missing.length ? missing : null
});

describe('rangeCompleteness', () => {
  const ACTIVE = ['ILJ', 'AMDK'];

  it('menghitung per entitas-bulan', () => {
    const r: PeriodRange = { mode: 'custom', from: '2026-01-01', to: '2026-02-01' };
    const c = rangeCompleteness(r, [completeness('2026-01-01', 2, []), completeness('2026-02-01', 1, ['AMDK'])], ACTIVE);
    expect(c).toEqual({ months: 2, expected: 4, reported: 3, is_complete: false, missing: [{ code: 'AMDK', months: 1 }] });
  });

  /** Bulan tanpa satu periode pun dihitung belum lapor untuk semua, bukan dilewati. */
  it('bulan tanpa periode sama sekali tidak membuat rentang tampak lengkap', () => {
    const r: PeriodRange = { mode: 'custom', from: '2026-01-01', to: '2026-03-01' };
    const c = rangeCompleteness(r, [completeness('2026-01-01', 2, [])], ACTIVE);
    expect(c.is_complete).toBe(false);
    expect(c.reported).toBe(2);
    expect(c.expected).toBe(6);
    expect(c.missing).toEqual([{ code: 'AMDK', months: 2 }, { code: 'ILJ', months: 2 }]);
  });

  it('lengkap hanya bila semua entitas-bulan disetujui', () => {
    const r: PeriodRange = { mode: 'bulanan', from: '2026-01-01', to: '2026-01-01' };
    expect(rangeCompleteness(r, [completeness('2026-01-01', 2, [])], ACTIVE).is_complete).toBe(true);
  });

  it('sameCoverage membandingkan himpunan entitas-bulan', () => {
    const r: PeriodRange = { mode: 'bulanan', from: '2026-01-01', to: '2026-01-01' };
    const a = rangeCompleteness(r, [completeness('2026-01-01', 1, ['AMDK'])], ACTIVE);
    const b = rangeCompleteness(r, [completeness('2026-01-01', 1, ['ILJ'])], ACTIVE);
    expect(sameCoverage(a, a)).toBe(true);
    expect(sameCoverage(a, b)).toBe(false);
  });
});

describe('entityTotals', () => {
  const row = (entity_id: string, period: string, status: PeriodPnl['status'], revenue: string): PeriodPnl =>
    ({ entity_id, period, status, revenue, net_profit: revenue }) as PeriodPnl;

  it('hanya bulan yang disetujui yang dijumlahkan', () => {
    const t = entityTotals([
      row('e1', '2026-01-01', 'approved', '100.10'),
      row('e1', '2026-02-01', 'locked', '200'),
      row('e1', '2026-03-01', 'draft', '999')
    ]).get('e1');
    expect(t).toEqual({ countedMonths: 2, revenue: '300.10', netProfit: '300.10', latestStatus: 'draft' });
  });
});
