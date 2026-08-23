/**
 * The ILJ parser, against a workbook built to contain every trap
 * `docs/task/03-import-ilj.md` documents in the real file.
 *
 * A seventh test file, beyond the six `docs/task/05-regression-tests.md` asks
 * for. The rule there is about not splitting the *database* suite into a tree
 * nobody can navigate; this covers a standalone script and belongs nowhere in
 * those six. It also earns its place: the real workbook is not in the repo, so
 * without a synthetic one the parser has no proof at all that it works.
 *
 * The figures below are invented. Only the shapes are real — the July total
 * row, the March row numbered with the wrong year, the duplicated invoice
 * numbers, the `#N/A`, the statement block that moves column every month.
 * Two of the constants match the documented file (Rp103.985.000 of uang saku
 * and a July result of −2.178.807) because those are the two the task names as
 * the pass condition.
 */

import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  INVOICE_SHEET,
  buildReport,
  buildSql,
  computeNetProfit,
  importWorkbook,
  linesFor,
  sheetToPeriod,
  sqlText,
  type PeriodTotals
} from '../scripts/import-ilj';

// ---------------------------------------------------------------------------
// Workbook construction
// ---------------------------------------------------------------------------

type CellValue = number | string | { error: true };

function makeSheet(cells: Record<string, CellValue>): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {};
  let maxRow = 0;
  let maxCol = 0;

  for (const [ref, value] of Object.entries(cells)) {
    const { r, c } = XLSX.utils.decode_cell(ref);
    maxRow = Math.max(maxRow, r);
    maxCol = Math.max(maxCol, c);

    if (typeof value === 'number') sheet[ref] = { t: 'n', v: value };
    else if (typeof value === 'string') sheet[ref] = { t: 's', v: value };
    // 0x2A is Excel's #N/A. The parser must read it as zero, not throw.
    else sheet[ref] = { t: 'e', v: 0x2a, w: '#N/A' };
  }

  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
  return sheet;
}

interface InvoiceRow {
  invoice: string;
  tagihan?: number;
  pajak?: number;
  saku?: number;
  terpal?: number;
  ops?: number;
  rekanan?: number | { error: true };
}

/** One line of `DATABASE KPL`, at the given Excel row number. */
function invoiceCells(row: number, data: InvoiceRow): Record<string, CellValue> {
  const cells: Record<string, CellValue> = { [`B${row}`]: data.invoice };
  const put = (col: string, value: number | { error: true } | undefined) => {
    if (value !== undefined) cells[`${col}${row}`] = value;
  };
  put('H', data.tagihan);
  put('I', data.pajak);
  put('J', data.saku);
  put('K', data.terpal);
  put('L', data.ops);
  put('M', data.rekanan);
  // N (PROFIT OPS) is a subtotal in the source. Written here precisely so the
  // test proves it is never imported.
  if (typeof data.tagihan === 'number') cells[`N${row}`] = data.tagihan * 0.05;
  return cells;
}

/**
 * A "Laporan Laba Rugi" block. `anchor` is where the heading sits, and the
 * figures live two columns to its right — the real file puts the block in a
 * different column every month, which is the whole reason the parser searches
 * for it rather than reading fixed cells.
 */
function statementBlock(
  anchorCol: string,
  anchorRow: number,
  valueCol: string,
  rows: Array<[string, number]>
): Record<string, CellValue> {
  const cells: Record<string, CellValue> = {
    [`${anchorCol}${anchorRow}`]: 'Laporan Laba Rugi'
  };
  rows.forEach(([label, amount], i) => {
    const r = anchorRow + 1 + i;
    cells[`${anchorCol}${r}`] = label;
    cells[`${valueCol}${r}`] = amount;
  });
  return cells;
}

// ---------------------------------------------------------------------------
// The fixture workbook
// ---------------------------------------------------------------------------

/** July's revenue. The total row below repeats it — importing both doubles it. */
const JULY_REVENUE = 235_416_417;
const JULY_NET = -2_178_807;
const JULY_SAKU = 103_985_000;

function buildWorkbook(): XLSX.WorkBook {
  const kpl: Record<string, CellValue> = {
    // Row 1 — the sheet's own header. Above the first separator, so it must be
    // reported as preamble and never counted as an invoice.
    A1: 'NO',
    B1: 'NO INVOICE',
    H1: 'TAGIHAN',
    I1: 'PAJAK',
    J1: 'SAKU',
    K1: 'TERPAL',
    L1: 'OPERASIONAL',
    M1: 'REKANAN',
    N1: 'PROFIT OPS',

    // Row 2 blank.
    B3: 'NOVEMBER',
    ...invoiceCells(4, {
      invoice: '01/ILJ/NOVEMBER/2024',
      tagihan: 100_000_000,
      pajak: 2_000_000,
      terpal: 500_000,
      ops: 1_500_000,
      rekanan: 83_000_000
    }),
    ...invoiceCells(5, {
      invoice: '02/ILJ/NOVEMBER/2024',
      tagihan: 50_000_000,
      pajak: 1_000_000,
      terpal: 250_000,
      ops: 750_000,
      rekanan: 41_500_000
    }),

    // Row 6 blank.
    B7: 'DESEMBER',
    ...invoiceCells(8, {
      invoice: '03/ILJ/DESEMBER/2024',
      tagihan: 80_000_000,
      pajak: 1_600_000,
      ops: 1_200_000,
      rekanan: 66_400_000
      // No terpal at all — the line must be left out of the SQL entirely.
    }),

    B9: 'JANUARI',
    // The same invoice number twice. Both are kept and summed.
    ...invoiceCells(10, {
      invoice: '017B/JANUARI',
      tagihan: 30_000_000,
      pajak: 600_000,
      terpal: 150_000,
      ops: 450_000,
      rekanan: 24_900_000
    }),
    ...invoiceCells(11, {
      invoice: '017B/JANUARI',
      tagihan: 20_000_000,
      pajak: 400_000,
      terpal: 100_000,
      ops: 300_000,
      rekanan: 16_600_000
    }),

    B12: 'MARET',
    ...invoiceCells(13, {
      invoice: '05/ILJ/MARET/2025',
      tagihan: 60_000_000,
      pajak: 1_200_000,
      terpal: 300_000,
      ops: 900_000,
      rekanan: 49_800_000
    }),
    // Numbered 2024, belongs to March 2025. The separator decides, not this.
    ...invoiceCells(14, {
      invoice: '06/ILJ/MARET/2024',
      tagihan: 4_935_040,
      pajak: 98_700,
      rekanan: 4_096_083
    }),

    B15: 'JULI',
    ...invoiceCells(16, {
      invoice: '026/ILJ/JULI-2025',
      tagihan: 100_000_000,
      pajak: 9_000_000,
      saku: 44_000_000,
      terpal: 700_000,
      ops: 2_000_000,
      rekanan: 83_000_000
    }),
    ...invoiceCells(17, {
      invoice: '030/ILJ-JULI-2025',
      tagihan: 135_416_417,
      pajak: 12_300_000,
      saku: 59_985_000,
      terpal: 800_000,
      ops: 2_200_000,
      rekanan: 112_395_626
    }),
    // Has a number and a vessel, but no billing and an #N/A partner share.
    // An incomplete record, not a missing transaction: imported as zero.
    ...invoiceCells(18, {
      invoice: '044/ILJ/JULI-2025',
      tagihan: 0,
      rekanan: { error: true }
    }),

    // The TOTAL row. No invoice number, and column H repeats July's revenue.
    H19: JULY_REVENUE,
    N19: 11_770_820
  };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, makeSheet(kpl), INVOICE_SHEET);

  // Each month's statement block sits in a different column and row.
  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      statementBlock('Z', 10, 'AB', [
        ['Beban Usaha', 0],
        ['Gaji Karyawan', 9_000_000],
        ['Sewa Kantor', 1_500_000],
        ['Total Beban Usaha', 10_500_000],
        ['Pendapatan Bersih', 9_000_000]
      ])
    ),
    'Nov 24'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      statementBlock('Z', 12, 'AB', [
        ['Gaji Karyawan', 9_000_000],
        ['Beban Kantor & ATK', 400_000],
        ['Pendapatan Bersih', 1_400_000]
      ])
    ),
    'Des 24'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      statementBlock('AC', 8, 'AE', [
        ['Gaji Karyawan', 5_000_000],
        ['Laba Bersih', 1_500_000]
      ])
    ),
    'Jan 25'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      statementBlock('T', 15, 'V', [
        ['Gaji Karyawan', 6_000_000],
        ['Perizinan & Retribusi', 500_000],
        ['Pendapatan Bersih', 2_040_257]
      ])
    ),
    'Mar 25'
  );

  XLSX.utils.book_append_sheet(
    workbook,
    makeSheet(
      statementBlock('L', 20, 'N', [
        ['Gaji Karyawan', 9_500_000],
        ['Sewa Kantor', 1_500_000],
        ['Beban Kantor & ATK', 750_000],
        ['Jasa Konsultan Pajak', 1_250_000],
        ['Perizinan & Retribusi', 850_000],
        ['Biaya Lain-lain', 1_349_598],
        ['Pendapatan Bersih', JULY_NET]
      ])
    ),
    'Jul 25'
  );

  // A sheet whose name is not a month. It must be ignored, not guessed at.
  XLSX.utils.book_append_sheet(workbook, makeSheet({ A1: 'Rekap' }), 'REKAP TAHUNAN');

  return workbook;
}

function periodOf(periods: PeriodTotals[], key: string): PeriodTotals {
  const found = periods.find((p) => p.period === key);
  if (!found) throw new Error(`Periode ${key} tidak ada di hasil impor`);
  return found;
}

const result = importWorkbook(buildWorkbook());
const { periods, report } = result;

// ---------------------------------------------------------------------------

describe('penentuan periode', () => {
  it('menemukan setiap pemisah bulan dan mencetak barisnya', () => {
    expect(report.separators).toEqual([
      'baris 3: NOVEMBER',
      'baris 7: DESEMBER',
      'baris 9: JANUARI',
      'baris 12: MARET',
      'baris 15: JULI'
    ]);
  });

  it('menaikkan tahun saat bulan berputar, tanpa peta yang di-hardcode', () => {
    expect(periods.map((p) => p.period)).toEqual([
      '2024-11-01',
      '2024-12-01',
      '2025-01-01',
      '2025-03-01',
      '2025-07-01'
    ]);
  });

  it('menempatkan invoice bertahun salah ke bulan pemisahnya', () => {
    // 06/ILJ/MARET/2024 says 2024; the separator says March 2025 and wins.
    // Rp4.935.040 has to be inside March 2025's revenue.
    expect(periodOf(periods, '2025-03-01').tagihan).toBe(64_935_040);
    expect(periods.some((p) => p.period.startsWith('2024-03'))).toBe(false);
  });

  it('melaporkan tahun invoice yang janggal alih-alih mengikutinya', () => {
    expect(report.yearAnomalies).toHaveLength(1);
    expect(report.yearAnomalies[0]).toContain('MARET 2025');
    expect(report.yearAnomalies[0]).toContain('2024');
  });
});

describe('baris yang tidak boleh masuk', () => {
  it('melewati baris total dan mencetak nilainya', () => {
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].row).toBe(19);
    expect(report.skipped[0].reason).toBe('tanpa nomor invoice');
    expect(report.skipped[0].values).toContain('235.416.417');
  });

  it('tidak menggandakan pendapatan Juli', () => {
    expect(periodOf(periods, '2025-07-01').tagihan).toBe(JULY_REVENUE);
    expect(periodOf(periods, '2025-07-01').tagihan).not.toBe(JULY_REVENUE * 2);
  });

  it('memisahkan header sheet dari baris yang perlu ditinjau', () => {
    // Row 1 is a heading, not a suspicious row. Reported, but not as a
    // finding — otherwise the review warning fires on every single run.
    expect(report.preamble.map((p) => p.row)).toEqual([1]);
  });

  it('melewati baris kosong tanpa berkomentar', () => {
    expect(report.blankRows).toBe(2);
  });

  it('tidak pernah membaca kolom subtotal N', () => {
    // Every N cell is 5% of H. If N leaked into any line, one of these would
    // be off by exactly that.
    expect(periodOf(periods, '2024-11-01').tagihan).toBe(150_000_000);
    expect(periodOf(periods, '2024-11-01').rekanan).toBe(124_500_000);
  });
});

describe('nomor invoice ganda', () => {
  it('menjumlahkan keduanya, tidak membuang salah satu', () => {
    expect(periodOf(periods, '2025-01-01').tagihan).toBe(50_000_000);
    expect(periodOf(periods, '2025-01-01').invoiceCount).toBe(2);
  });

  it('mencatatnya di laporan', () => {
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]).toMatchObject({
      invoice: '017B/JANUARI',
      rows: [10, 11],
      total: 50_000_000
    });
  });
});

describe('#N/A dan catatan tak lengkap', () => {
  it('membaca #N/A sebagai nol, bukan sebagai error', () => {
    // July's partner share is the sum of the two complete rows only.
    expect(periodOf(periods, '2025-07-01').rekanan).toBe(195_395_626);
  });

  it('mencatat invoice bernilai nol supaya keberadaannya terlihat', () => {
    expect(report.errorCells.join('\n')).toContain('044/ILJ/JULI-2025');
    expect(report.errorCells.join('\n')).toContain('REKANAN');
    expect(periodOf(periods, '2025-07-01').invoiceCount).toBe(3);
  });
});

describe('beban usaha dari sheet bulanan', () => {
  it('menemukan blok laba rugi di kolom mana pun ia berpindah', () => {
    expect(report.sheetsMapped).toEqual([
      'Nov 24 → 2024-11 (blok di Z10)',
      'Des 24 → 2024-12 (blok di Z12)',
      'Jan 25 → 2025-01 (blok di AC8)',
      'Mar 25 → 2025-03 (blok di T15)',
      'Jul 25 → 2025-07 (blok di L20)'
    ]);
  });

  it('memetakan label ke line_code', () => {
    const july = periodOf(periods, '2025-07-01');
    expect(Object.fromEntries(july.opex)).toEqual({
      OPEX_GAJI: 9_500_000,
      OPEX_SEWA: 1_500_000,
      OPEX_ATK: 750_000,
      OPEX_PROF: 1_250_000,
      OPEX_PERIZINAN: 850_000,
      OPEX_LAIN: 1_349_598
    });
  });

  it('tidak mengimpor subtotal di dalam blok', () => {
    // "Total Beban Usaha" of 10.500.000 sits between the two November lines
    // and the terminator. Importing it would double November's opex.
    expect(Object.fromEntries(periodOf(periods, '2024-11-01').opex)).toEqual({
      OPEX_GAJI: 9_000_000,
      OPEX_SEWA: 1_500_000
    });
    expect(report.ignoredLabels.map((l) => l.label)).toContain('Total Beban Usaha');
  });

  it('tidak menganggap sheet non-bulanan sebagai periode', () => {
    expect(sheetToPeriod('REKAP TAHUNAN')).toBeNull();
    expect(sheetToPeriod('Nov 24')).toBe('2024-11-01');
    expect(sheetToPeriod('Jul 25')).toBe('2025-07-01');
  });
});

describe('uang saku', () => {
  it('mengimpor nol dan menaruh angkanya di catatan', () => {
    const july = periodOf(periods, '2025-07-01');
    expect(july.saku).toBe(JULY_SAKU);

    const saku = linesFor(july).find((line) => line.code === 'COGS_SAKU');
    expect(saku?.amount).toBe(0);
    expect(saku?.note).toContain('103.985.000');
    expect(saku?.note).toContain('A-2');
  });

  it('tidak menulis baris sama sekali saat sumbernya nihil', () => {
    const codes = linesFor(periodOf(periods, '2024-11-01')).map((line) => line.code);
    expect(codes).not.toContain('COGS_SAKU');
  });
});

describe('baris yang ditulis', () => {
  it('melewati pos bernilai nol yang tidak punya catatan', () => {
    const codes = linesFor(periodOf(periods, '2024-12-01')).map((line) => line.code);
    expect(codes).not.toContain('COGS_TERPAL');
    expect(codes).toContain('COGS_OPS');
  });

  it('memberi catatan pada terpal, karena porsinya belum terdokumentasi', () => {
    const terpal = linesFor(periodOf(periods, '2025-07-01')).find(
      (line) => line.code === 'COGS_TERPAL'
    );
    expect(terpal?.amount).toBe(1_500_000);
    expect(terpal?.note).toContain('50%');
  });
});

describe('verifikasi terhadap sumber', () => {
  it('mencocokkan laba bersih setiap periode', () => {
    const mismatched = report.verification.filter((v) => Math.abs(v.diff) > 1);
    expect(mismatched).toEqual([]);
    expect(report.verification).toHaveLength(5);
  });

  it('menghasilkan −2.178.807 untuk Juli 2025', () => {
    expect(computeNetProfit(linesFor(periodOf(periods, '2025-07-01')))).toBe(JULY_NET);
  });

  it('rekanan ada di kisaran 83% dari tagihan', () => {
    for (const period of periods) {
      if (period.tagihan === 0) continue;
      expect(period.rekanan / period.tagihan).toBeGreaterThan(0.8);
      expect(period.rekanan / period.tagihan).toBeLessThan(0.86);
    }
  });
});

describe('label opex tak dikenal', () => {
  /**
   * A separate workbook. An unrecognised label is not merely reported — it
   * also makes the imported net profit disagree with the source's, because
   * the source counted the expense and the import did not. Verification has
   * to fail, and a failed verification writes no SQL at all.
   */
  const oddWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    oddWorkbook,
    makeSheet({
      B1: 'NOVEMBER',
      ...invoiceCells(2, {
        invoice: '01/ILJ/NOVEMBER/2024',
        tagihan: 100_000_000,
        rekanan: 83_000_000
      })
    }),
    INVOICE_SHEET
  );
  XLSX.utils.book_append_sheet(
    oddWorkbook,
    makeSheet(
      statementBlock('C', 5, 'E', [
        ['Gaji Karyawan', 9_000_000],
        ['Sumbangan Kegiatan Warga', 250_000],
        ['Pendapatan Bersih', 7_750_000]
      ])
    ),
    'Nov 24'
  );

  const odd = importWorkbook(oddWorkbook);

  it('melaporkan label beserta sheet dan selnya', () => {
    expect(odd.report.unknownLabels).toHaveLength(1);
    expect(odd.report.unknownLabels[0]).toMatchObject({
      sheet: 'Nov 24',
      cell: 'C7',
      label: 'Sumbangan Kegiatan Warga',
      amount: 250_000
    });
  });

  it('tidak memasukkannya diam-diam ke OPEX_LAIN', () => {
    expect(odd.periods[0].opex.has('OPEX_LAIN')).toBe(false);
    expect(Object.fromEntries(odd.periods[0].opex)).toEqual({ OPEX_GAJI: 9_000_000 });
  });

  it('membuat verifikasi gagal, sehingga tidak ada SQL yang ditulis', () => {
    const { failed, text } = buildReport(odd.periods, odd.report);
    expect(failed).toBe(true);
    expect(text).toContain('PERIKSA DULU');
  });
});

describe('SQL yang dihasilkan', () => {
  const sql = buildSql(periods, buildReport(periods, report).text, 'fixture.xlsx');

  it('membungkus semuanya dalam satu transaksi', () => {
    expect(sql).toContain('begin;');
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
  });

  it('membuat sembilan… ternyata lima periode di fixture ini, satu per bulan', () => {
    const inserts = sql.match(/insert into periods /g) ?? [];
    expect(inserts).toHaveLength(periods.length);
  });

  it('menaikkan status lewat dua UPDATE terpisah', () => {
    // guard_period_transition() only allows one step at a time.
    expect(sql).toContain("set status = 'submitted'");
    expect(sql).toContain("set status = 'approved'");
    expect(sql.indexOf("set status = 'submitted'")).toBeLessThan(
      sql.indexOf("set status = 'approved'")
    );
  });

  it('mengajukan dan menyetujui dengan akun berbeda', () => {
    const submitter = sql.match(/submitted_by = '([^']+)'/)?.[1];
    const approver = sql.match(/approved_by = '([^']+)'/)?.[1];
    expect(submitter).toBeTruthy();
    expect(approver).toBeTruthy();
    expect(submitter).not.toBe(approver);
  });

  it('tidak mengunci periode mana pun', () => {
    expect(sql).not.toContain("status = 'locked'");
  });

  it('menulis pendapatan Juli sekali, bukan dua kali', () => {
    expect(sql).toContain("'REV_TAGIHAN', 235416417.00");
    expect(sql).not.toContain('470832834');
  });

  it('meng-escape kutip satu di dalam literal', () => {
    expect(sqlText("catatan 'uji'")).toBe("'catatan ''uji'''");
  });

  it('mengomentari seluruh laporan, termasuk teks berbaris banyak', () => {
    // Unknown labels come out of the workbook, and a cell may contain a line
    // break. Every line of the report has to carry its own `--`, or the rest
    // of the header becomes executable SQL.
    const generated = buildSql(periods, 'baris satu\nbaris dua', 'fixture.xlsx');
    const header = generated.slice(0, generated.indexOf('begin;'));
    for (const line of header.split('\n')) {
      expect(line === '' || line.startsWith('--')).toBe(true);
    }
    expect(header).toContain('--  baris dua');
  });
});
