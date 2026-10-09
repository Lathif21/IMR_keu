/**
 * Rentang waktu dasbor: bulanan, tahunan, atau custom (dari–sampai bulan).
 *
 * Satuannya tetap bulan. Laporan di sistem ini adalah laba-rugi bulanan, jadi
 * "custom" berarti rentang bulan, bukan rentang tanggal — tidak ada angka di
 * bawah satu bulan yang bisa dijumlahkan.
 *
 * Semua periode berbentuk "YYYY-MM-01", sama seperti kolom `periods.period`.
 */

import type { GroupConsolidated, Numeric, PeriodCompleteness, PeriodPnl } from '$lib/domain';
import { currentPeriod, formatPeriod, nextPeriod, previousPeriod } from '$lib/format';

export type RangeMode = 'bulanan' | 'tahunan' | 'custom';

export interface PeriodRange {
  mode: RangeMode;
  /** Bulan pertama, inklusif. */
  from: string;
  /** Bulan terakhir, inklusif. */
  to: string;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])(-01)?$/;
const YEAR = /^\d{4}$/;

/** Rentang custom terpanjang. Lebih dari ini hanya membuat kueri berat. */
export const MAX_CUSTOM_MONTHS = 60;

function asPeriod(raw: string | null): string | null {
  const match = raw?.match(MONTH);
  return match ? `${match[1]}-${match[2]}-01` : null;
}

/** Bulan-bulan dari `from` sampai `to`, inklusif, urut naik. */
export function monthsBetween(from: string, to: string): string[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const out: string[] = [];
  for (let p = a; p <= b; p = nextPeriod(p)) out.push(p);
  return out;
}

/**
 * Membaca rentang dari URL.
 *
 *   ?mode=bulanan&periode=2026-09       satu bulan
 *   ?mode=tahunan&tahun=2026            Januari–Desember
 *   ?mode=custom&dari=2026-01&sampai=2026-06
 *
 * `?periode=` tanpa `mode` tetap dibaca sebagai bulanan, supaya tautan lama
 * tidak rusak. Nilai yang tidak sah jatuh ke periode terbaru, bukan 404 —
 * bookmark yang sudah basi tetap harus mendarat di tempat yang jujur.
 *
 * Tahun berjalan dipotong sampai bulan ini (`today`). Bulan yang belum
 * terjadi tidak punya laporan, dan menghitungnya sebagai "belum lapor" akan
 * membuat setiap tahun berjalan tampak tertinggal delapan bulan.
 */
export function resolveRange(
  params: URLSearchParams,
  newest: string,
  today: string = currentPeriod()
): PeriodRange {
  const mode = params.get('mode');

  if (mode === 'tahunan') {
    const raw = params.get('tahun');
    const year = raw && YEAR.test(raw) ? raw : newest.slice(0, 4);
    const december = `${year}-12-01`;
    const from = `${year}-01-01`;
    return { mode, from, to: december > today && from <= today ? today : december };
  }

  if (mode === 'custom') {
    const from = asPeriod(params.get('dari')) ?? newest;
    const to = asPeriod(params.get('sampai')) ?? from;
    const [a, b] = from <= to ? [from, to] : [to, from];
    const months = monthsBetween(a, b);
    const capped = months.length > MAX_CUSTOM_MONTHS ? months[MAX_CUSTOM_MONTHS - 1] : b;
    return { mode, from: a, to: capped };
  }

  const single = asPeriod(params.get('periode')) ?? newest;
  return { mode: 'bulanan', from: single, to: single };
}

/**
 * Rentang pembanding dengan panjang yang sama, tepat sebelumnya.
 *
 *   bulanan  bulan sebelumnya (MoM)
 *   tahunan  bulan-bulan yang sama setahun sebelumnya (YoY)
 *   custom   rentang sepanjang itu yang berakhir sebulan sebelum `from`
 */
export function previousRange(range: PeriodRange): PeriodRange {
  if (range.mode === 'tahunan') {
    const shift = (p: string) => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;
    return { mode: range.mode, from: shift(range.from), to: shift(range.to) };
  }
  const length = monthsBetween(range.from, range.to).length;
  const to = previousPeriod(range.from);
  let from = to;
  for (let i = 1; i < length; i++) from = previousPeriod(from);
  return { mode: range.mode, from, to };
}

/** "September 2026", "2026", "2026 (Januari – Oktober)", "November 2025 – Februari 2026". */
export function rangeLabel(range: PeriodRange): string {
  if (range.mode === 'tahunan') {
    const year = range.from.slice(0, 4);
    return range.to.endsWith('-12-01') ? year : `${year} (${monthName(range.from)} – ${monthName(range.to)})`;
  }
  if (range.from === range.to) return formatPeriod(range.from);
  if (range.from.slice(0, 4) === range.to.slice(0, 4)) {
    return `${monthName(range.from)} – ${formatPeriod(range.to)}`;
  }
  return `${formatPeriod(range.from)} – ${formatPeriod(range.to)}`;
}

function monthName(period: string): string {
  return formatPeriod(period).split(' ')[0];
}

/** Penanda perbandingan. MoM tidak pernah dilabeli YoY, dan sebaliknya. */
export function comparisonTag(mode: RangeMode): string {
  if (mode === 'bulanan') return 'MoM';
  if (mode === 'tahunan') return 'YoY';
  return 'vs. sebelumnya';
}

// ---------------------------------------------------------------------------
// Penjumlahan
// ---------------------------------------------------------------------------

/**
 * `numeric(18,2)` ke sen sebagai bigint. PostgREST bisa mengirim number atau
 * string; keduanya dibaca tanpa menjumlahkan float.
 */
function toSen(value: Numeric): bigint {
  if (typeof value === 'number') return BigInt(Math.round(value * 100));
  const negative = value.trim().startsWith('-');
  const [whole, fraction = ''] = value.trim().replace(/^[-+]/, '').split('.');
  const sen = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -sen : sen;
}

function fromSen(sen: bigint): string {
  const negative = sen < 0n;
  const abs = negative ? -sen : sen;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Jumlah tepat ke sen. Null bila tidak ada satu nilai pun — beda dari nol. */
export function sumAmounts(values: (Numeric | null | undefined)[]): string | null {
  const present = values.filter((v): v is Numeric => v !== null && v !== undefined && v !== '');
  if (present.length === 0) return null;
  return fromSen(present.reduce((total, v) => total + toSen(v), 0n));
}

// ---------------------------------------------------------------------------
// Agregasi untuk dasbor
// ---------------------------------------------------------------------------

export type RangeConsolidated = Pick<
  GroupConsolidated,
  'revenue_sum' | 'elimination' | 'revenue_consolidated' | 'cogs_sum' | 'opex_sum' | 'net_profit_consolidated'
>;

/**
 * Jumlah baris `v_group_consolidated` dalam rentang. View itu sudah hanya
 * menghitung periode approved/locked, jadi penjumlahan di sini mewarisi aturan
 * yang sama tanpa perlu mengulanginya. Null bila tak satu bulan pun punya
 * angka disetujui.
 */
export function aggregateConsolidated(rows: GroupConsolidated[]): RangeConsolidated | null {
  if (rows.length === 0) return null;
  const sum = (key: keyof RangeConsolidated) => sumAmounts(rows.map((r) => r[key])) ?? '0.00';
  return {
    revenue_sum: sum('revenue_sum'),
    elimination: sum('elimination'),
    revenue_consolidated: sum('revenue_consolidated'),
    cogs_sum: sum('cogs_sum'),
    opex_sum: sum('opex_sum'),
    net_profit_consolidated: sum('net_profit_consolidated')
  };
}

export interface RangeCompleteness {
  months: number;
  /** Entitas aktif × bulan. */
  expected: number;
  /** Entitas-bulan yang sudah approved/locked. */
  reported: number;
  is_complete: boolean;
  /** Per entitas: berapa bulan dalam rentang yang belum disetujui. */
  missing: { code: string; months: number }[];
}

/**
 * Kelengkapan sebuah rentang, dihitung per entitas-bulan.
 *
 * `v_period_completeness` hanya punya baris untuk bulan yang pernah dibuat
 * periodenya. Bulan dalam rentang yang tidak punya baris sama sekali berarti
 * tidak satu entitas pun melapor — dihitung sebagai belum masuk untuk semua,
 * bukan dilewati. Melewatinya akan membuat tahun yang baru terisi dua bulan
 * terlihat lengkap.
 */
export function rangeCompleteness(
  range: PeriodRange,
  rows: PeriodCompleteness[],
  activeCodes: string[]
): RangeCompleteness {
  const byMonth = new Map(rows.map((r) => [r.period, r]));
  const months = monthsBetween(range.from, range.to);
  const missing = new Map<string, number>();
  let reported = 0;

  for (const month of months) {
    const row = byMonth.get(month);
    const codes = row ? (row.missing_entities ?? []) : activeCodes;
    reported += row ? row.reported_entities : 0;
    for (const code of codes) missing.set(code, (missing.get(code) ?? 0) + 1);
  }

  const expected = months.length * activeCodes.length;
  return {
    months: months.length,
    expected,
    reported,
    is_complete: expected > 0 && reported === expected,
    missing: [...missing.entries()]
      .map(([code, n]) => ({ code, months: n }))
      .sort((a, b) => a.code.localeCompare(b.code))
  };
}

/**
 * Apakah dua rentang mencakup himpunan entitas-bulan yang sama. Kalau tidak,
 * sebagian besar "pertumbuhan" adalah entitas yang datang atau pergi, bukan
 * perubahan kinerja — perbandingannya ditandai, tidak diwarnai hijau.
 */
export function sameCoverage(a: RangeCompleteness, b: RangeCompleteness): boolean {
  const key = (c: RangeCompleteness) => c.missing.map((m) => `${m.code}:${m.months}`).join(',');
  return key(a) === key(b);
}

export interface EntityTotals {
  /** Bulan approved/locked dalam rentang. */
  countedMonths: number;
  revenue: string | null;
  netProfit: string | null;
  /** Status bulan terakhir yang punya periode, untuk label "Draft" dsb. */
  latestStatus: PeriodPnl['status'] | null;
}

/** Jumlah per entitas, hanya dari bulan yang disetujui. */
export function entityTotals(rows: PeriodPnl[]): Map<string, EntityTotals> {
  const grouped = new Map<string, PeriodPnl[]>();
  for (const row of rows) grouped.set(row.entity_id, [...(grouped.get(row.entity_id) ?? []), row]);

  const out = new Map<string, EntityTotals>();
  for (const [entityId, list] of grouped) {
    const counted = list.filter((r) => r.status === 'approved' || r.status === 'locked');
    const latest = [...list].sort((a, b) => b.period.localeCompare(a.period))[0];
    out.set(entityId, {
      countedMonths: counted.length,
      revenue: sumAmounts(counted.map((r) => r.revenue)),
      netProfit: sumAmounts(counted.map((r) => r.net_profit)),
      latestStatus: latest?.status ?? null
    });
  }
  return out;
}
