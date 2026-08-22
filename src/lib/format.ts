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

/**
 * Month-over-month change, as a percentage. Never year-over-year — the
 * prototype labelled one as the other.
 *
 * Divided by `Math.abs(prior)` so the sign of the result describes the
 * direction of the change and not the sign of the base: a loss shrinking from
 * −10 to −5 is an improvement, and dividing by a negative would report it as
 * −50%. Returns null when there is nothing to compare against; a prior of
 * zero has no meaningful percentage.
 */
export function momPct(
  current: string | number | null | undefined,
  prior: string | number | null | undefined
): number | null {
  const a = toAmount(current);
  const b = toAmount(prior);
  if (a === null || b === null || b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

/**
 * Change between two percentages, in percentage points: "+0,9 pp".
 *
 * A margin moving from 1,22% to 2,08% has not risen "70,5%" — that is a
 * percentage of a percentage, and reading it as a margin is one of the ways a
 * reviewer talks themselves into approving the wrong number. The difference is
 * 0,86 points, and it says so.
 */
export function formatDeltaPoints(
  current: string | number | null | undefined,
  prior: string | number | null | undefined
): string {
  const a = toAmount(current);
  const b = toAmount(prior);
  if (a === null || b === null) return NO_DATA;
  const diff = a - b;
  const body = Math.abs(diff).toLocaleString('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${diff < 0 ? MINUS : '+'}${body} pp`;
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

/**
 * Inverse of `formatAmount`, for the entry form. Both the browser and the
 * server action parse with this — the value that arrives in the POST is
 * whatever the field held, which may be raw digits or an already-formatted
 * string, so one parser has to accept both.
 *
 * Indonesian input mixes `.` as the thousands separator and `,` as the
 * decimal. A report line is always whole Rupiah, so neither survives — but
 * the decimals have to be *dropped*, not merely stripped of their comma.
 * Deleting every non-digit turns "1.500.000,00" into 150000000, a hundredfold
 * overstatement that looks like a plausible figure. So a trailing decimal
 * group goes first, then every remaining separator.
 *
 * A comma is only a decimal point when one or two digits follow it at the end
 * of the value. That is what keeps "1,500,000" — a US-style paste — reading as
 * one and a half million rather than fifteen hundred.
 *
 * The sign is read before the strip: a leading minus, or the accounting
 * parentheses `formatAmount` itself emits. A value that came back through
 * this function must not lose its sign.
 *
 * Empty is 0, never null. `report_lines.amount` is NOT NULL, and a blank
 * field means "nothing this month", which is zero.
 */
export function parseAmountInput(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const trimmed = raw.trim();
  const negative =
    trimmed.startsWith('-') ||
    trimmed.startsWith(MINUS) ||
    (trimmed.startsWith('(') && trimmed.endsWith(')'));
  const whole = trimmed.replace(/,\d{1,2}\)?\s*$/, '');
  const digits = whole.replace(/\D/g, '');
  if (digits === '') return 0;
  const n = Number(digits);
  return negative ? -n : n;
}

/**
 * Widest value `numeric(18,2)` holds: 18 digits of precision, 2 of them after
 * the point. Past this the database raises 22003 rather than one of our own
 * Indonesian messages, so the action checks the bound itself.
 */
export const AMOUNT_LIMIT = 1e16;

/** "2025-12-01" -> "2026-01-01". Default month for the next new period. */
export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const date = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${date.y}-${String(date.m).padStart(2, '0')}-01`;
}

/**
 * The business is Indonesian, so "this month" means this month in Jakarta.
 * A server running on UTC is up to 7 hours behind, which on the 1st of the
 * month would default a new period to the month that just ended.
 */
const JAKARTA = 'Asia/Jakarta';

export function currentPeriod(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA,
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}-01`;
}

/** "2025-07-01" -> "2025-07", the form `[period]` takes in the URL. */
export function periodToMonth(period: string): string {
  return period.slice(0, 7);
}

/** "2025-07" -> "2025-07-01". Periods are always stored as the 1st. */
export function monthToPeriod(month: string): string {
  return `${month}-01`;
}

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * A timestamp, pinned to Jakarta. Not the viewer's timezone: the same string
 * has to come out of SSR and out of hydration, and a UTC server rendering
 * "23:40 yesterday" where the browser renders "06:40 today" is a mismatch on
 * every row.
 */
/** Date only, Jakarta: "15 Agu 2025". Same timezone reasoning as
    formatDateTime below. */
export function formatDate(v: string | null | undefined): string {
  if (!v) return NO_DATA;
  const at = new Date(v);
  if (Number.isNaN(at.getTime())) return NO_DATA;
  return at.toLocaleDateString('id-ID', {
    timeZone: JAKARTA,
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

export function formatDateTime(v: string | null | undefined): string {
  if (!v) return NO_DATA;
  const at = new Date(v);
  if (Number.isNaN(at.getTime())) return NO_DATA;
  return at.toLocaleString('id-ID', {
    timeZone: JAKARTA,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
