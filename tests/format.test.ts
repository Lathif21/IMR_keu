/**
 * `src/lib/format.ts`. No database, so this one runs in milliseconds — run it
 * as often as you like.
 *
 * Every case below is a way a figure has gone wrong on a screen before: a
 * hundredfold overstatement from stripping a decimal comma, a loss rendered
 * as growth, a bar overflowing its track, an em dash where a zero belonged.
 */

import { describe, expect, it } from 'vitest';
import {
  AMOUNT_LIMIT,
  NO_DATA,
  clampPct,
  currentPeriod,
  formatAmount,
  formatCompact,
  formatDelta,
  formatDeltaPoints,
  formatPct,
  formatPeriod,
  momPct,
  monthToPeriod,
  nextPeriod,
  parseAmountInput,
  periodToMonth,
  previousPeriod,
  shareOf,
  toAmount
} from '$lib/format';

describe('toAmount', () => {
  it('menerima string maupun number dari PostgREST', () => {
    // numeric(18,2) comes back as a JSON number or a string depending on the
    // version. Both have to reach arithmetic as a number, or `+` concatenates.
    expect(toAmount(235_000_000)).toBe(235_000_000);
    expect(toAmount('235000000.00')).toBe(235_000_000);
    expect(toAmount('-2178807.00')).toBe(-2_178_807);
  });

  it('membedakan kosong dari nol', () => {
    expect(toAmount(0)).toBe(0);
    expect(toAmount('0')).toBe(0);
    expect(toAmount(null)).toBeNull();
    expect(toAmount(undefined)).toBeNull();
    expect(toAmount('')).toBeNull();
  });

  it('menolak yang bukan angka', () => {
    expect(toAmount('bukan angka')).toBeNull();
  });
});

describe('formatAmount', () => {
  it('menulis negatif dalam kurung, bukan dengan tanda minus', () => {
    expect(formatAmount(-2_178_807)).toBe('(2.178.807)');
    expect(formatAmount(2_178_807)).toBe('2.178.807');
  });

  it('menampilkan nol sebagai nol dan kosong sebagai em dash', () => {
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(null)).toBe(NO_DATA);
  });
});

describe('formatCompact', () => {
  it('memendekkan ke juta dan miliar', () => {
    expect(formatCompact(7_150_000_000)).toBe('Rp 7,15 M');
    expect(formatCompact(858_000_000)).toBe('Rp 858 jt');
    expect(formatCompact(4_200)).toBe('Rp 4.200');
  });

  it('mempertahankan kurung untuk negatif', () => {
    expect(formatCompact(-2_178_807)).toBe('(Rp 2,2 jt)');
  });
});

describe('momPct', () => {
  it('membagi dengan nilai mutlak, sehingga arah perubahan yang terbaca', () => {
    // A loss shrinking from −10 to −5 is an improvement. Dividing by a
    // negative base would report it as −50%.
    expect(momPct(-5, -10)).toBe(50);
    expect(momPct(-10, -5)).toBe(-100);
    expect(momPct(110, 100)).toBeCloseTo(10);
  });

  it('kosong bila tidak ada pembanding', () => {
    expect(momPct(100, 0)).toBeNull();
    expect(momPct(100, null)).toBeNull();
    expect(momPct(null, 100)).toBeNull();
  });
});

describe('persentase', () => {
  it('formatDelta memakai tanda minus sungguhan, bukan hyphen', () => {
    expect(formatDelta(-8.2)).toBe('−8,2%');
    expect(formatDelta(12.4)).toBe('+12,4%');
    expect(formatDelta(null)).toBe(NO_DATA);
  });

  it('formatPct tidak memaksa tanda plus', () => {
    expect(formatPct(6.6)).toBe('6,6%');
    expect(formatPct(-0.93, 2)).toBe('−0,93%');
    expect(formatPct(null)).toBe(NO_DATA);
  });

  it('formatDeltaPoints menyatakan selisih margin dalam poin', () => {
    // 1,22% → 2,08% is 0,86 points, not a 70,5% rise. Reading it the other
    // way is how a reviewer talks themselves into the wrong number.
    expect(formatDeltaPoints(2.08, 1.22)).toBe('+0,86 pp');
    expect(formatDeltaPoints(1.22, 2.08)).toBe('−0,86 pp');
    expect(formatDeltaPoints(null, 2)).toBe(NO_DATA);
  });
});

describe('clampPct', () => {
  it('menahan di 0–100', () => {
    // The prototype interpolated `width: ${margin}%` unbounded, and a share
    // above 100 or below 0 broke out of its track.
    expect(clampPct(150)).toBe(100);
    expect(clampPct(-20)).toBe(0);
    expect(clampPct(42.5)).toBe(42.5);
  });

  it('menganggap nilai tak berhingga sebagai nol, bukan sebagai bar penuh', () => {
    // A share of infinity is not a very large share, it is a division that
    // should not have happened. An empty track says that; a full one asserts
    // something the data never supported.
    expect(clampPct(null)).toBe(0);
    expect(clampPct(undefined)).toBe(0);
    expect(clampPct(Number.NaN)).toBe(0);
    expect(clampPct(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('shareOf kosong tanpa total, bukan nol', () => {
    expect(shareOf(50, 200)).toBe(25);
    expect(shareOf(50, 0)).toBeNull();
    expect(shareOf(null, 200)).toBeNull();
  });
});

describe('parseAmountInput', () => {
  it('membaca angka bergrup maupun angka polos jadi nilai yang sama', () => {
    expect(parseAmountInput('1.500.000')).toBe(1_500_000);
    expect(parseAmountInput('1500000')).toBe(1_500_000);
  });

  it('membuang desimal, tidak sekadar menghapus komanya', () => {
    // Deleting every non-digit turns "1.500.000,00" into 150.000.000 — a
    // hundredfold overstatement that still looks like a plausible figure.
    expect(parseAmountInput('1.500.000,00')).toBe(1_500_000);
    expect(parseAmountInput('1.500.000,5')).toBe(1_500_000);
  });

  it('membaca tempelan gaya AS sebagai ribuan', () => {
    expect(parseAmountInput('1,500,000')).toBe(1_500_000);
  });

  it('mempertahankan tanda, termasuk dari kurung akuntansi', () => {
    expect(parseAmountInput('-2178807')).toBe(-2_178_807);
    expect(parseAmountInput('(2.178.807)')).toBe(-2_178_807);
    expect(parseAmountInput('−2.178.807')).toBe(-2_178_807);
  });

  it('bolak-balik lewat formatAmount tanpa kehilangan tanda', () => {
    for (const value of [0, 1_500_000, -2_178_807, 235_416_417]) {
      expect(parseAmountInput(formatAmount(value))).toBe(value);
    }
  });

  it('kosong menghasilkan 0, bukan null', () => {
    // report_lines.amount is NOT NULL, and a blank field means "nothing this
    // month", which is zero.
    expect(parseAmountInput('')).toBe(0);
    expect(parseAmountInput('   ')).toBe(0);
    expect(parseAmountInput(null)).toBe(0);
    expect(parseAmountInput(undefined)).toBe(0);
  });

  it('AMOUNT_LIMIT sesuai lebar numeric(18,2)', () => {
    expect(AMOUNT_LIMIT).toBe(1e16);
  });
});

describe('periode', () => {
  it('formatPeriod tidak tergeser oleh zona waktu', () => {
    // Parsed by hand rather than through Date, so a browser west of UTC can
    // never shift a period into the previous month.
    expect(formatPeriod('2025-07-01')).toBe('Juli 2025');
    expect(formatPeriod('2025-01-01')).toBe('Januari 2025');
  });

  it('previousPeriod menyeberangi batas tahun', () => {
    expect(previousPeriod('2025-07-01')).toBe('2025-06-01');
    expect(previousPeriod('2025-01-01')).toBe('2024-12-01');
  });

  it('nextPeriod menyeberangi batas tahun', () => {
    expect(nextPeriod('2025-12-01')).toBe('2026-01-01');
    expect(nextPeriod('2025-07-01')).toBe('2025-08-01');
  });

  it('periodToMonth dan monthToPeriod saling membalik', () => {
    expect(periodToMonth('2025-07-01')).toBe('2025-07');
    expect(monthToPeriod('2025-07')).toBe('2025-07-01');
    expect(monthToPeriod(periodToMonth('2024-11-01'))).toBe('2024-11-01');
  });

  it('currentPeriod memakai waktu Jakarta, bukan UTC', () => {
    // 31 Dec 2025, 18:00 UTC is already 1 Jan 2026 in Jakarta. A server on UTC
    // would default a new period to the month that just ended.
    expect(currentPeriod(new Date('2025-12-31T18:00:00Z'))).toBe('2026-01-01');
    expect(currentPeriod(new Date('2025-07-15T03:00:00Z'))).toBe('2025-07-01');
  });
});

describe('NO_DATA', () => {
  it('dipakai untuk null, tidak pernah untuk nol', () => {
    expect(formatAmount(null)).toBe(NO_DATA);
    expect(formatCompact(null)).toBe(NO_DATA);
    expect(formatDelta(null)).toBe(NO_DATA);
    expect(formatPct(null)).toBe(NO_DATA);

    expect(formatAmount(0)).not.toBe(NO_DATA);
    expect(formatCompact(0)).not.toBe(NO_DATA);
    expect(formatDelta(0)).not.toBe(NO_DATA);
    expect(formatPct(0)).not.toBe(NO_DATA);
  });
});
