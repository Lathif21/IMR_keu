/**
 * Presentation of money and percentages. This is the ONLY layer allowed to
 * shorten a figure to juta/miliar — the database stores full Rupiah and
 * every calculation happens there (CLAUDE.md invariant 3).
 *
 * Conventions this file enforces, from src/app.css:
 *   - negatives render in parentheses, not with a minus sign
 *   - no data renders as an em dash, which is distinct from zero
 *   - real minus sign (U+2212) in percentage deltas, not a hyphen
 */

/** What renders when a figure is absent. Zero is a figure; this is not. */
export const NO_DATA = '—';

const MINUS = '−';

/**
 * The single entry point for a `numeric(18,2)` value. PostgREST hands it back
 * as a JSON number or a string depending on version, so both are accepted.
 * Rupiah amounts in this business stay far below 2^53, so Number() is sound —
 * but parse at the edge, once, rather than letting a string reach arithmetic
 * where `+` would silently concatenate.
 */
export function toAmount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Full Rupiah, grouped, negatives in parentheses: (2.178.807) */
export function formatAmount(v: string | number | null | undefined): string {
  const n = toAmount(v);
  if (n === null) return NO_DATA;
  const digits = Math.abs(n).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  return n < 0 ? `(${digits})` : digits;
}

/**
 * Shortened for KPI tiles: "Rp 7,15 M", "Rp 858 jt", "Rp 4.200".
 * M = miliar, jt = juta. Negatives keep the parentheses convention.
 */
export function formatCompact(v: string | number | null | undefined): string {
  const n = toAmount(v);
  if (n === null) return NO_DATA;

  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1_000_000_000) {
    body = `${(abs / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  } else if (abs >= 1_000_000) {
    body = `${(abs / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  } else {
    body = abs.toLocaleString('id-ID', { maximumFractionDigits: 0 });
  }

  return n < 0 ? `(Rp ${body})` : `Rp ${body}`;
}

/** Signed percentage delta: "+12,4%", "−8,2%". Real minus sign. */
export function formatDelta(v: string | number | null | undefined): string {
  const n = toAmount(v);
  if (n === null) return NO_DATA;
  const body = Math.abs(n).toLocaleString('id-ID', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  return `${n < 0 ? MINUS : '+'}${body}%`;
}

/**
 * Percentage without a forced sign: "6,6%", "−0,93%". A negative margin gets
 * the real minus sign, not the hyphen `toLocaleString` would produce.
 */
export function formatPct(v: string | number | null | undefined, digits = 1): string {
  const n = toAmount(v);
  if (n === null) return NO_DATA;
  const body = Math.abs(n).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
  return `${n < 0 ? MINUS : ''}${body}%`;
}

/**
 * Bar widths must be clamped. The prototype wrote `width: ${margin}%` with no
 * bound, so a share above 100 or below 0 overflowed its track.
 */
export function clampPct(v: number | null | undefined): number {
  if (v === null || v === undefined || !Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

/** Share of a total, as a clamped percentage. Returns null if there is no total. */
export function shareOf(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total === 0) return null;
  return clampPct((part / total) * 100);
}

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/**
 * "2025-07-01" -> "Juli 2025". Parsed by hand rather than through Date, so
 * the browser's timezone can never shift a period into the previous month.
 */
export function formatPeriod(period: string): string {
  const [year, month] = period.split('-');
  const index = Number(month) - 1;
  return MONTHS[index] ? `${MONTHS[index]} ${year}` : period;
}

/** "2025-07-01" -> "2025-06-01", for labelling the month a delta compares to. */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const date = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  return `${date.y}-${String(date.m).padStart(2, '0')}-01`;
}
