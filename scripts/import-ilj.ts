/**
 * Import PT Indra Langgeng Jaya's real monthly figures (Nov 2024 – Jul 2025)
 * out of `Presentasi_Rekap_Income_Full_ILJ__Revisi_FIX.xlsx` and into a SQL
 * seed a human reads before it touches a database.
 *
 *   npx tsx scripts/import-ilj.ts <path-to-xlsx> [--out supabase/seed-ilj.sql]
 *                                                [--start-year 2024]
 *
 * This script never connects to Postgres. Historical financial data that
 * lands silently, without review, is the fastest way to bury a wrong number
 * for months — so the output is a file, and applying it is a separate,
 * deliberate act.
 *
 * `xlsx` (SheetJS) is a devDependency. The version on npm is 0.18.5 and
 * carries two unpatched advisories (prototype pollution, ReDoS); SheetJS
 * publishes fixes only through their own CDN. It is tolerated here because
 * this script runs on the operator's own workbook, offline, on a developer
 * machine — it is never reachable from the app and never sees user input.
 * Do not move `xlsx` into `dependencies`.
 *
 * The parsing rules are exported and covered by `tests/import-ilj.test.ts`,
 * which builds a workbook reproducing every trap the real file contains. The
 * traps are documented in `docs/task/03-import-ilj.md`; read it before
 * changing any rule below.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Target rows in the seeded local database. These come from supabase/seed.sql;
// the generated file is dev seed data and is meant to run beside it.
// ---------------------------------------------------------------------------

const ILJ_CODE = 'ILJ';
const TEMPLATE_CODE = 'TRUCKING_V1';

/**
 * Submitter and approver must be different accounts, or segregation of duties
 * (invariant 6) refuses the approval.
 */
const STAFF_ID = 'a0000000-0000-4000-a000-000000000003';
const MANAGER_ID = 'a0000000-0000-4000-a000-000000000002';

// ---------------------------------------------------------------------------
// Source layout
// ---------------------------------------------------------------------------

export const INVOICE_SHEET = 'DATABASE KPL';

/** 0-based column indices. B=1 … N=13. */
const COL = {
  invoice: 1, // B — nomor invoice
  tagihan: 7, // H — REV_TAGIHAN
  pajak: 8, // I — COGS_PAJAK
  saku: 9, // J — uang saku, see A-2 in linesFor()
  terpal: 10, // K — COGS_TERPAL
  ops: 11, // L — COGS_OPS
  rekanan: 12 // M — COGS_REKANAN
} as const;

/**
 * N (PROFIT OPS) is a subtotal of the columns to its left. It is read only to
 * decide whether a row is blank — never imported (invariant 2).
 *
 * C (kapal), D (telly), E (lokasi), F (muatan) and G (ritase) are operational
 * data. This system does not store them (CONTEXT.md).
 */
const SUBTOTAL_COL = 13;

/** Every column that carries a figure, for "is this row empty" tests. */
const VALUE_COLS = [
  COL.tagihan,
  COL.pajak,
  COL.saku,
  COL.terpal,
  COL.ops,
  COL.rekanan,
  SUBTOTAL_COL
];

const MONTHS_ID = [
  'JANUARI',
  'FEBRUARI',
  'MARET',
  'APRIL',
  'MEI',
  'JUNI',
  'JULI',
  'AGUSTUS',
  'SEPTEMBER',
  'OKTOBER',
  'NOVEMBER',
  'DESEMBER'
];

/** Monthly sheet names look like `Nov 24`. Indonesian and English both. */
const MONTH_ABBR: Record<string, number> = {
  jan: 1,
  feb: 2,
  peb: 2,
  mar: 3,
  apr: 4,
  mei: 5,
  may: 5,
  jun: 6,
  jul: 7,
  agu: 8,
  ags: 8,
  aug: 8,
  sep: 9,
  okt: 10,
  oct: 10,
  nov: 11,
  des: 12,
  dec: 12
};

// ---------------------------------------------------------------------------
// Opex label mapping
//
// Substring match, lower-cased, first rule wins — so `sewa` is tested before
// `kantor`, otherwise "Sewa Kantor" would land in OPEX_ATK.
//
// There is deliberately no catch-all. The task table reads "sisanya →
// OPEX_LAIN", but the paragraph under it forbids bucketing an unrecognised
// label silently, and that paragraph is the one protecting the report: an
// expense that quietly becomes "lain-lain" is how a statement stops meaning
// anything. So OPEX_LAIN has its own explicit patterns, and a label matching
// nothing at all is reported with its sheet and cell for a human to map.
// ---------------------------------------------------------------------------

const OPEX_RULES: Array<{ code: string; patterns: string[] }> = [
  { code: 'OPEX_GAJI', patterns: ['gaji', 'upah', 'karyawan', 'thr'] },
  { code: 'OPEX_SEWA', patterns: ['sewa'] },
  { code: 'OPEX_ATK', patterns: ['atk', 'alat tulis', 'beban kantor', 'biaya kantor', 'kantor'] },
  {
    code: 'OPEX_PROF',
    patterns: ['konsultan', 'notaris', 'fee pajak', 'jasa profesional', 'akuntan', 'legal']
  },
  { code: 'OPEX_PERIZINAN', patterns: ['perizinan', 'perijinan', 'izin', 'ijin', 'retribusi'] },
  {
    code: 'OPEX_LAIN',
    patterns: ['lain-lain', 'lain lain', 'lainnya', 'serba serbi', 'operasional lain', 'rupa-rupa']
  }
];

/**
 * Labels inside the statement block that are not expense lines: subtotals,
 * headings, and the revenue line the block restates. Importing a subtotal
 * would double-count it (invariant 2). Nothing here is dropped silently —
 * every match is listed in the parsing report.
 */
const NON_EXPENSE_PATTERNS = [
  'total',
  'jumlah',
  'sub total',
  'subtotal',
  'laba kotor',
  'laba usaha',
  'laba operasi',
  'pendapatan usaha',
  'omset',
  'penjualan',
  'hpp',
  'harga pokok',
  'beban usaha',
  'biaya usaha',
  'laporan laba rugi'
];

/** The block ends here. Its value is the source's own net profit. */
const NET_PROFIT_PATTERNS = ['pendapatan bersih', 'laba bersih'];

const ANCHOR_TEXT = 'laporan laba rugi';

// ---------------------------------------------------------------------------
// Cell reading
// ---------------------------------------------------------------------------

type Sheet = XLSX.WorkSheet;

interface Cell {
  /** 0 when the cell is empty or holds an error. */
  value: number;
  /** True for `#N/A` and friends. Treated as zero, never as a crash. */
  isError: boolean;
  /** True when the cell holds nothing at all. */
  isEmpty: boolean;
  /** Whatever was in there, for anomaly reporting. */
  raw: unknown;
}

const EMPTY_CELL: Cell = { value: 0, isError: false, isEmpty: true, raw: null };

function cellRef(r: number, c: number): string {
  return XLSX.utils.encode_cell({ r, c });
}

function readNumber(sheet: Sheet, r: number, c: number): Cell {
  const cell = sheet[cellRef(r, c)] as XLSX.CellObject | undefined;
  if (!cell || cell.v === undefined || cell.v === null || cell.v === '') return EMPTY_CELL;

  // `#N/A` in the source marks an incomplete record, not a parse failure.
  if (cell.t === 'e') return { value: 0, isError: true, isEmpty: false, raw: cell.w ?? '#N/A' };

  if (typeof cell.v === 'number') {
    return { value: cell.v, isError: false, isEmpty: false, raw: cell.v };
  }

  // Text holding a figure. Indonesian grouping: `.` thousands, `,` decimal.
  const text = String(cell.v).trim();
  const normalised = text
    .replace(/[Rr][Pp]\.?/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.');
  const parsed = Number(normalised);
  if (normalised !== '' && Number.isFinite(parsed)) {
    return { value: parsed, isError: false, isEmpty: false, raw: text };
  }

  // Not a number and not empty — a stray label in a value column. Zero, and
  // loud about it.
  return { value: 0, isError: true, isEmpty: false, raw: text };
}

function readText(sheet: Sheet, r: number, c: number): string {
  const cell = sheet[cellRef(r, c)] as XLSX.CellObject | undefined;
  if (!cell || cell.v === undefined || cell.v === null) return '';
  return String(cell.v).trim();
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// The parsing report. Everything the operator has to look at before applying
// the SQL ends up here, and in the header of the generated file.
//
// It is created per run rather than kept in module state, so two imports in
// one process cannot accumulate into each other's totals.
// ---------------------------------------------------------------------------

export interface Skipped {
  row: number;
  reason: string;
  values: string;
}

export interface LabelSighting {
  sheet: string;
  cell: string;
  label: string;
  amount: number;
}

export interface Duplicate {
  invoice: string;
  period: string;
  rows: number[];
  total: number;
}

export interface Verification {
  period: string;
  computed: number;
  /** NaN when the source sheet's own net profit could not be read. */
  source: number;
  diff: number;
}

export interface ImportReport {
  separators: string[];
  invoicesProcessed: number;
  /** Rows above the first month separator: headings, not data. */
  preamble: Skipped[];
  skipped: Skipped[];
  blankRows: number;
  errorCells: string[];
  duplicates: Duplicate[];
  yearAnomalies: string[];
  unknownLabels: LabelSighting[];
  ignoredLabels: LabelSighting[];
  sheetsMapped: string[];
  verification: Verification[];
}

function emptyReport(): ImportReport {
  return {
    separators: [],
    invoicesProcessed: 0,
    preamble: [],
    skipped: [],
    blankRows: 0,
    errorCells: [],
    duplicates: [],
    yearAnomalies: [],
    unknownLabels: [],
    ignoredLabels: [],
    sheetsMapped: [],
    verification: []
  };
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export interface PeriodTotals {
  /** `YYYY-MM-01`. */
  period: string;
  monthName: string;
  separatorRow: number;
  invoiceCount: number;
  tagihan: number;
  pajak: number;
  terpal: number;
  ops: number;
  rekanan: number;
  /** Reported, never imported. See A-2 in linesFor(). */
  saku: number;
  opex: Map<string, number>;
  /** Net profit as the source sheet states it. Filled from the monthly sheet. */
  sourceNetProfit: number | null;
}

function emptyPeriod(period: string, monthName: string, separatorRow: number): PeriodTotals {
  return {
    period,
    monthName,
    separatorRow,
    invoiceCount: 0,
    tagihan: 0,
    pajak: 0,
    terpal: 0,
    ops: 0,
    rekanan: 0,
    saku: 0,
    opex: new Map(),
    sourceNetProfit: null
  };
}

function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function majority(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// ---------------------------------------------------------------------------
// Pass 1 — invoices
// ---------------------------------------------------------------------------

/**
 * Which month a row belongs to comes from the separator rows in column B, not
 * from the invoice number. Three reasons, all present in the file:
 *
 *   1. Row 207 is numbered `06/ILJ/MARET/2024` and belongs to March 2025.
 *      Trusting the number moves Rp4.935.040 into a month that does not exist
 *      in this dataset, where nobody would ever look for it.
 *   2. The format is inconsistent — slashes, dashes, and dashes in a
 *      different place.
 *   3. Five numbers appear twice.
 *
 * Row positions are never hardcoded. They are found here and printed, so a
 * workbook whose layout shifted fails visibly instead of quietly importing
 * the wrong months.
 */
export function parseInvoices(
  sheet: Sheet,
  report: ImportReport,
  startYearOverride: number | null = null
): PeriodTotals[] {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');

  interface Block {
    monthIndex: number; // 0-based
    monthName: string;
    separatorRow: number; // Excel row number
    rows: number[]; // Excel row numbers of the data rows below it
  }

  const blocks: Block[] = [];
  /** Block index -> the years its invoice numbers claim. */
  const invoiceYears = new Map<number, number[]>();

  let current: Block | null = null;

  for (let r = range.s.r; r <= range.e.r; r++) {
    const excelRow = r + 1;
    const label = readText(sheet, r, COL.invoice);
    const cells = VALUE_COLS.map((c) => readNumber(sheet, r, c));
    const hasValue = cells.some((cell) => !cell.isEmpty);

    // --- month separator: a bare month name, no figures anywhere ------------
    const monthIndex = MONTHS_ID.indexOf(label.toUpperCase().replace(/[^A-Z]/g, ''));
    if (label !== '' && monthIndex >= 0 && !hasValue) {
      current = { monthIndex, monthName: MONTHS_ID[monthIndex], separatorRow: excelRow, rows: [] };
      blocks.push(current);
      report.separators.push(`baris ${excelRow}: ${MONTHS_ID[monthIndex]}`);
      continue;
    }

    // --- completely blank: skip without comment -----------------------------
    if (label === '' && !hasValue) {
      report.blankRows++;
      continue;
    }

    /**
     * Anything above the first separator is the sheet's own header. It is
     * listed, but kept apart from `skipped`: the review warning at the end of
     * the report has to mean something, and a warning that fires on every run
     * because of row 1 is a warning nobody reads.
     */
    if (!current) {
      report.preamble.push({
        row: excelRow,
        reason: 'sebelum pemisah bulan pertama',
        values: label === '' ? '(tanpa nomor invoice)' : label
      });
      continue;
    }

    /**
     * No invoice number, but figures present. This is row 362 — the TOTAL row,
     * whose column H equals the sum of the July block above it. Importing it
     * doubles July's revenue and nothing anywhere would flag that. Every such
     * row is skipped and printed with its values, so a total row is visible as
     * a total row and not as data that went missing.
     */
    if (label === '') {
      const values = VALUE_COLS.map(
        (c, i) => `${XLSX.utils.encode_col(c)}=${formatIdr(cells[i].value)}`
      ).join(' ');
      report.skipped.push({ row: excelRow, reason: 'tanpa nomor invoice', values });
      continue;
    }

    current.rows.push(excelRow);

    const blockIndex = blocks.length - 1;
    const year = label.match(/(20\d{2})/);
    if (year) {
      const list = invoiceYears.get(blockIndex) ?? [];
      list.push(Number(year[1]));
      invoiceYears.set(blockIndex, list);
    }
  }

  if (blocks.length === 0) {
    throw new Error(
      `Tidak ada satu pun baris pemisah bulan di sheet "${INVOICE_SHEET}". ` +
        'Struktur file berubah — periksa kolom B sebelum melanjutkan.'
    );
  }

  /**
   * The first block's year is the majority vote of the invoice numbers inside
   * it, so one mistyped year cannot outvote the rest. From there the year
   * advances whenever the month number stops increasing, which is what makes
   * Nov 2024 → Des 2024 → Jan 2025 come out right with no hardcoded map.
   */
  const startYear = startYearOverride ?? majority(invoiceYears.get(0) ?? []);
  if (startYear === null) {
    throw new Error(
      'Tahun awal tidak dapat disimpulkan: tidak ada nomor invoice bertahun di blok pertama. ' +
        'Jalankan ulang dengan --start-year YYYY.'
    );
  }

  const periods: PeriodTotals[] = [];
  let year = startYear;

  blocks.forEach((block, i) => {
    if (i > 0 && block.monthIndex <= blocks[i - 1].monthIndex) year++;

    const period = periodKey(year, block.monthIndex + 1);
    const totals = emptyPeriod(period, block.monthName, block.separatorRow);

    /**
     * Cross-check the rolled year against what the invoice numbers claim. A
     * disagreement is reported, never obeyed — that is the row-207 case, and
     * seeing it in the report is the proof the separator won.
     */
    const claimed = invoiceYears.get(i) ?? [];
    const odd = claimed.filter((y) => y !== year);
    if (odd.length > 0) {
      report.yearAnomalies.push(
        `${block.monthName} ${year}: ${odd.length} nomor invoice menyebut tahun ` +
          `${[...new Set(odd)].join('/')} — dipakai ${year} dari pemisah bulan`
      );
    }

    const seen = new Map<string, { rows: number[]; total: number }>();

    for (const excelRow of block.rows) {
      const r = excelRow - 1;
      const invoice = readText(sheet, r, COL.invoice);

      const tagihan = readNumber(sheet, r, COL.tagihan);
      const pajak = readNumber(sheet, r, COL.pajak);
      const saku = readNumber(sheet, r, COL.saku);
      const terpal = readNumber(sheet, r, COL.terpal);
      const ops = readNumber(sheet, r, COL.ops);
      const rekanan = readNumber(sheet, r, COL.rekanan);

      /**
       * `044/ILJ/JULI-2025` has an invoice number, a vessel and 256,51 tonnes
       * carried, but TAGIHAN = 0 and REKANAN = `#N/A`. It is an incomplete
       * record, not a missing transaction: imported as zero, and listed here,
       * so its existence is visible even though its effect on the figures is
       * nil.
       */
      for (const [name, cell] of [
        ['TAGIHAN', tagihan],
        ['PAJAK', pajak],
        ['SAKU', saku],
        ['TERPAL', terpal],
        ['OPERASIONAL', ops],
        ['REKANAN', rekanan]
      ] as const) {
        if (cell.isError) {
          report.errorCells.push(`baris ${excelRow} ${invoice} ${name}=${String(cell.raw)} → 0`);
        }
      }

      totals.tagihan += tagihan.value;
      totals.pajak += pajak.value;
      totals.saku += saku.value;
      totals.terpal += terpal.value;
      totals.ops += ops.value;
      totals.rekanan += rekanan.value;
      totals.invoiceCount++;
      report.invoicesProcessed++;

      /**
       * Duplicated numbers are summed, not de-duplicated. Dropping one copy
       * changes the client's figures on the strength of a guess about which
       * copy is real, and there is nothing in the file that says.
       */
      const key = invoice.toUpperCase();
      const prior = seen.get(key);
      if (prior) {
        prior.rows.push(excelRow);
        prior.total += tagihan.value;
      } else {
        seen.set(key, { rows: [excelRow], total: tagihan.value });
      }
    }

    for (const [invoice, info] of seen) {
      if (info.rows.length > 1) {
        report.duplicates.push({ invoice, period, rows: info.rows, total: info.total });
      }
    }

    periods.push(totals);
  });

  return periods;
}

// ---------------------------------------------------------------------------
// Pass 2 — operating expenses, from the monthly sheets
// ---------------------------------------------------------------------------

/**
 * The "Laporan Laba Rugi" block moves every month — its column runs Z, Z, AC,
 * Z, T, W, U, X, L across the nine sheets, and "Pendapatan Bersih" sits on row
 * 26 in some and 27 in others. Fixed coordinates would read empty cells for
 * most of the year and report zero opex without complaining, so the block is
 * located by its heading text instead.
 */
export function parseOpexSheet(
  sheet: Sheet,
  sheetName: string,
  totals: PeriodTotals,
  report: ImportReport
): void {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');

  let anchor: { r: number; c: number } | null = null;
  for (let r = range.s.r; r <= range.e.r && !anchor; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (normalise(readText(sheet, r, c)).includes(ANCHOR_TEXT)) {
        anchor = { r, c };
        break;
      }
    }
  }

  if (!anchor) {
    throw new Error(
      `Sheet "${sheetName}": teks "${ANCHOR_TEXT}" tidak ditemukan. ` +
        'Blok laba rugi tidak dapat dibaca — periksa sheet-nya sebelum melanjutkan.'
    );
  }

  report.sheetsMapped.push(
    `${sheetName} → ${totals.period.slice(0, 7)} (blok di ${cellRef(anchor.r, anchor.c)})`
  );

  /** How far right of the label the figure may sit. The block is narrow. */
  const VALUE_SPAN = 6;
  /** Give up after this many consecutive label-less rows. */
  const MAX_GAP = 8;

  let gap = 0;

  for (let r = anchor.r + 1; r <= range.e.r; r++) {
    const label = readText(sheet, r, anchor.c);

    if (label === '') {
      gap++;
      if (gap > MAX_GAP) break;
      continue;
    }
    gap = 0;

    const key = normalise(label);

    // Value: the first non-empty cell to the right of the label.
    let amount = 0;
    let hasValue = false;
    for (let c = anchor.c + 1; c <= Math.min(anchor.c + VALUE_SPAN, range.e.c); c++) {
      const cell = readNumber(sheet, r, c);
      if (!cell.isEmpty) {
        amount = cell.value;
        hasValue = true;
        break;
      }
    }

    /**
     * Terminator. Its value is the source's own net profit — the number every
     * imported period is checked against, and the reason this loop reads the
     * whole block rather than stopping at the last expense.
     */
    if (NET_PROFIT_PATTERNS.some((p) => key.includes(p))) {
      totals.sourceNetProfit = amount;
      return;
    }

    if (NON_EXPENSE_PATTERNS.some((p) => key.includes(p))) {
      report.ignoredLabels.push({ sheet: sheetName, cell: cellRef(r, anchor.c), label, amount });
      continue;
    }

    const rule = OPEX_RULES.find((candidate) =>
      candidate.patterns.some((pattern) => key.includes(pattern))
    );

    if (!rule) {
      report.unknownLabels.push({ sheet: sheetName, cell: cellRef(r, anchor.c), label, amount });
      continue;
    }

    if (!hasValue) continue;
    totals.opex.set(rule.code, (totals.opex.get(rule.code) ?? 0) + amount);
  }

  throw new Error(
    `Sheet "${sheetName}": blok laba rugi tidak punya baris "Pendapatan Bersih" / ` +
      '"Laba Bersih". Tanpa angka pembanding, hasil impor tidak dapat diverifikasi.'
  );
}

/** `Nov 24` → `2024-11-01`. Returns null for sheets that are not monthly. */
export function sheetToPeriod(name: string): string | null {
  const match = name
    .trim()
    .toLowerCase()
    .match(/^([a-z]{3})[a-z]*\.?\s*'?(\d{2}|\d{4})$/);
  if (!match) return null;

  const month = MONTH_ABBR[match[1]];
  if (!month) return null;

  const raw = Number(match[2]);
  return periodKey(raw < 100 ? 2000 + raw : raw, month);
}

// ---------------------------------------------------------------------------
// Whole-workbook import
// ---------------------------------------------------------------------------

export interface ImportResult {
  periods: PeriodTotals[];
  report: ImportReport;
}

export function importWorkbook(
  workbook: XLSX.WorkBook,
  options: { startYear?: number | null } = {}
): ImportResult {
  const report = emptyReport();

  const invoiceSheet = workbook.Sheets[INVOICE_SHEET];
  if (!invoiceSheet) {
    throw new Error(
      `Sheet "${INVOICE_SHEET}" tidak ada. Sheet yang tersedia: ${workbook.SheetNames.join(', ')}`
    );
  }

  const periods = parseInvoices(invoiceSheet, report, options.startYear ?? null);
  const byPeriod = new Map(periods.map((p) => [p.period, p]));

  // The monthly sheets carry the operating expenses; DATABASE KPL has none.
  for (const name of workbook.SheetNames) {
    if (name === INVOICE_SHEET) continue;
    const period = sheetToPeriod(name);
    if (!period) continue;

    const totals = byPeriod.get(period);
    if (!totals) {
      console.warn(
        `Sheet "${name}" memetakan ke ${period.slice(0, 7)}, yang tidak ada di ` +
          `${INVOICE_SHEET} — dilewati.`
      );
      continue;
    }
    parseOpexSheet(workbook.Sheets[name], name, totals, report);
  }

  for (const totals of periods) {
    const computed = computeNetProfit(linesFor(totals));
    report.verification.push({
      period: totals.period,
      computed,
      source: totals.sourceNetProfit ?? NaN,
      diff: totals.sourceNetProfit === null ? NaN : computed - totals.sourceNetProfit
    });
  }

  return { periods, report };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function formatIdr(value: number): string {
  return value.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function sqlAmount(value: number): string {
  return value.toFixed(2);
}

/**
 * A quoted SQL literal. Doubling the apostrophe is the whole job — line codes
 * and note text both pass through here, and a note reading "pembagian 50%
 * milik rekanan's" would otherwise end the literal early and turn the rest of
 * the sentence into syntax.
 */
export function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface Line {
  code: string;
  amount: number;
  note: string | null;
}

/**
 * Which lines a period writes. A line is emitted when it carries a figure, or
 * when it carries a note — a zero that needs explaining is worth a row, and a
 * zero that does not is just absence.
 */
export function linesFor(totals: PeriodTotals): Line[] {
  const lines: Line[] = [
    { code: 'REV_TAGIHAN', amount: totals.tagihan, note: null },
    { code: 'COGS_PAJAK', amount: totals.pajak, note: null },
    { code: 'COGS_REKANAN', amount: totals.rekanan, note: null },
    {
      code: 'COGS_TERPAL',
      amount: totals.terpal,
      note:
        totals.terpal === 0
          ? null
          : 'Diimpor apa adanya dari kolom TERPAL; sumber historis mencatat 50% dan ' +
            'pembagian biayanya belum terdokumentasi (CONTEXT.md)'
    },
    { code: 'COGS_OPS', amount: totals.ops, note: null },
    /**
     * A-2 is open, and this line is where that shows.
     *
     * The source sheet does not put uang saku into its profit & loss at all —
     * `M13 = SUM(M9:M12)` skips it. Reproducing what they reported means
     * importing zero. Reproducing it *silently* would hide a Rp104jt hole in
     * July.
     *
     * So: zero in the figure, the real amount in the note. Putting the number
     * in would be the parser choosing an accounting policy, which is
     * invariant 8; leaving it out entirely would be the parser hiding one.
     */
    {
      code: 'COGS_SAKU',
      amount: 0,
      note:
        totals.saku === 0
          ? null
          : `Sumber mencatat Rp${formatIdr(totals.saku)} di luar laba rugi — ASSUMPTIONS.md A-2`
    }
  ];

  for (const [code, amount] of [...totals.opex].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push({ code, amount, note: null });
  }

  return lines.filter((line) => line.amount !== 0 || line.note !== null);
}

/**
 * Net profit of the lines about to be written, by the same arithmetic as
 * `v_period_pnl`. Nothing here writes other_income, other_expense or tax, so
 * every non-revenue line subtracts.
 */
export function computeNetProfit(lines: Line[]): number {
  let net = 0;
  for (const line of lines) {
    if (line.code.startsWith('REV_')) net += line.amount;
    else net -= line.amount;
  }
  return net;
}

export function buildSql(
  periods: PeriodTotals[],
  reportText: string,
  sourceFile: string
): string {
  const out: string[] = [];
  const push = (line = '') => out.push(line);
  const periodList = periods.map((p) => `date ${sqlText(p.period)}`).join(', ');
  const target = '(select entity_id from _ilj_target)';

  push('-- =====================================================================');
  push('--  ILJ HISTORICAL IMPORT — generated by scripts/import-ilj.ts');
  push('--  Do not edit by hand. Re-run the parser instead.');
  push('--');
  push(`--  Source : ${sourceFile}`);
  push('--');
  push('--  Local development data. Never run against production.');
  push('--  Apply after `npm run db:reset`:');
  push('--    psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \\');
  push('--         -v ON_ERROR_STOP=1 -f supabase/seed-ilj.sql');
  push('--');
  push('--  PARSING REPORT');
  for (const line of reportText.split('\n')) push(`--  ${line}`.trimEnd());
  push('-- =====================================================================');
  push();
  push('-- Every step runs under an impersonated JWT, exactly as supabase/seed.sql');
  push('-- does. Seeding as postgres bypasses RLS but not triggers, so this file');
  push('-- passes through the same workflow guards the UI does — segregation of');
  push('-- duties included — and audit_log.actor_id comes out populated.');
  push();
  push('begin;');
  push();
  push('-- Resolved by code, not by literal uuid, so the file survives a reseed');
  push('-- that hands out different ids.');
  push('create temporary table _ilj_target on commit drop as');
  push('select');
  push(`  (select id from entities where code = ${sqlText(ILJ_CODE)}) as entity_id,`);
  push('  (select id from report_templates');
  push(`    where code = ${sqlText(TEMPLATE_CODE)} and is_active`);
  push('    order by version desc limit 1) as template_id;');
  push();
  push('do $$');
  push('begin');
  push('  if (select entity_id from _ilj_target) is null then');
  push(`    raise exception 'Entitas ${ILJ_CODE} tidak ada. Jalankan npm run db:reset dulu.';`);
  push('  end if;');
  push('  if (select template_id from _ilj_target) is null then');
  push(`    raise exception 'Template ${TEMPLATE_CODE} tidak ada atau tidak aktif.';`);
  push('  end if;');
  push('end $$;');
  push();

  push('-- --- 0. Clear the invented ILJ months --------------------------------');
  push('--');
  push('--  supabase/seed.sql ships ILJ months whose figures were made up to');
  push('--  exercise the MoM comparison. They collide with the real months below');
  push('--  on the (entity_id, period) unique index, and keeping either copy would');
  push("--  leave invented numbers sitting beside the client's own.");
  push('--');
  push('--  Going back to draft first is not ceremony: report_lines is immutable');
  push('--  while a period is approved (invariant 5), so the cascade would be');
  push('--  refused by the trigger. Unapproving needs can_approve(), hence the');
  push('--  manager claim, and a reason, hence rejection_note.');
  push(`set local request.jwt.claims = '{"sub":"${MANAGER_ID}","role":"authenticated"}';`);
  push();
  push('update periods');
  push("   set status = 'draft',");
  push('       rejection_note = ' + sqlText('Diganti data historis asli — scripts/import-ilj.ts'));
  push(` where entity_id = ${target}`);
  push(`   and period in (${periodList})`);
  push("   and status <> 'draft';");
  push();
  push('delete from report_lines');
  push(' where period_id in (');
  push('   select id from periods');
  push(`    where entity_id = ${target}`);
  push(`      and period in (${periodList})`);
  push(' );');
  push();
  push('delete from periods');
  push(` where entity_id = ${target}`);
  push(`   and period in (${periodList});`);
  push();

  push('-- --- 1. Periods and lines --------------------------------------------');
  push('--');
  push('--  Created as draft and then filled, because report_lines is only');
  push('--  writable while the period is draft. guard_period_insert() forces the');
  push('--  status and clears every workflow column, so passing anything else is');
  push('--  futile — and created_by comes from the claim, not from a column.');
  push(`set local request.jwt.claims = '{"sub":"${STAFF_ID}","role":"authenticated"}';`);
  push();

  for (const totals of periods) {
    const lines = linesFor(totals);
    const net = computeNetProfit(lines);
    const periodRef =
      `(select id from periods where entity_id = ${target} ` +
      `and period = date ${sqlText(totals.period)})`;

    push(`-- ${totals.monthName} ${totals.period.slice(0, 4)} · ${totals.invoiceCount} invoice`);
    push(
      `--   pendapatan ${formatIdr(totals.tagihan)} | laba bersih ${formatIdr(net)} ` +
        `| sumber ${formatIdr(totals.sourceNetProfit ?? 0)}`
    );
    if (totals.saku !== 0) {
      push(`--   uang saku di luar laba rugi: ${formatIdr(totals.saku)} (A-2)`);
    }
    push('insert into periods (entity_id, period, template_id)');
    push(`select entity_id, date ${sqlText(totals.period)}, template_id from _ilj_target;`);
    push();
    push('insert into report_lines (period_id, line_code, amount, note) values');
    push(
      lines
        .map(
          (line) =>
            `  (${periodRef}, ${sqlText(line.code)}, ${sqlAmount(line.amount)}, ` +
            `${line.note ? sqlText(line.note) : 'null'})`
        )
        .join(',\n') + ';'
    );
    push();
  }

  push('-- --- 2. Submit ---------------------------------------------------------');
  push('--  guard_period_transition() allows one step per statement, so submit and');
  push('--  approve cannot be collapsed into a single UPDATE.');
  push('update periods');
  push("   set status = 'submitted',");
  push(`       submitted_by = '${STAFF_ID}',`);
  push('       submitted_at = now()');
  push(` where entity_id = ${target}`);
  push(`   and period in (${periodList});`);
  push();
  push('-- --- 3. Approve --------------------------------------------------------');
  push('--  A different account, or invariant 6 refuses it.');
  push(`set local request.jwt.claims = '{"sub":"${MANAGER_ID}","role":"authenticated"}';`);
  push();
  push('update periods');
  push("   set status = 'approved',");
  push(`       approved_by = '${MANAGER_ID}',`);
  push('       approved_at = now()');
  push(` where entity_id = ${target}`);
  push(`   and period in (${periodList});`);
  push();
  push('-- Deliberately NOT locked. A-2 is still open; when uang saku is decided');
  push('-- these months have to be correctable without a director unlocking each.');
  push();
  push('commit;');
  push();

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Parsing report
// ---------------------------------------------------------------------------

export function buildReport(
  periods: PeriodTotals[],
  report: ImportReport
): { text: string; failed: boolean } {
  const lines: string[] = [];
  const matched = report.verification.filter((v) => Math.abs(v.diff) <= 1).length;
  const failed = matched !== report.verification.length;

  lines.push(`Periode diproses      : ${periods.length}`);
  lines.push(`Invoice diproses      : ${report.invoicesProcessed}`);
  lines.push(`Baris kosong dilewati : ${report.blankRows} (memang kosong, tanpa rincian)`);

  lines.push(`Baris sebelum bulan 1 : ${report.preamble.length} (header sheet)`);
  for (const item of report.preamble) {
    lines.push(`  baris ${item.row} — ${item.values}`);
  }

  lines.push(`Invoice dilewati      : ${report.skipped.length}`);
  for (const item of report.skipped) {
    lines.push(`  baris ${item.row} — ${item.reason} — ${item.values}`);
  }

  lines.push(`Sel #N/A jadi nol     : ${report.errorCells.length}`);
  for (const item of report.errorCells) lines.push(`  ${item}`);

  lines.push(`Nomor invoice ganda   : ${report.duplicates.length} (dijumlahkan, tidak dibuang)`);
  for (const dup of report.duplicates) {
    lines.push(
      `  ${dup.invoice} — baris ${dup.rows.join(' & ')} — total tagihan ${formatIdr(dup.total)}`
    );
  }

  lines.push(`Tahun invoice janggal : ${report.yearAnomalies.length}`);
  for (const item of report.yearAnomalies) lines.push(`  ${item}`);

  lines.push(`Label opex tak dikenal: ${report.unknownLabels.length}`);
  for (const item of report.unknownLabels) {
    lines.push(`  ${item.sheet}!${item.cell} "${item.label}" = ${formatIdr(item.amount)}`);
  }

  lines.push(
    `Label bukan beban     : ${report.ignoredLabels.length} (subtotal/judul, sengaja dilewati)`
  );
  for (const item of report.ignoredLabels) {
    lines.push(`  ${item.sheet}!${item.cell} "${item.label}" = ${formatIdr(item.amount)}`);
  }

  lines.push('Pemisah bulan         :');
  for (const item of report.separators) lines.push(`  ${item}`);

  lines.push('Sheet bulanan         :');
  for (const item of report.sheetsMapped) lines.push(`  ${item}`);

  lines.push('Uang saku di luar L/R :');
  for (const totals of periods) {
    lines.push(`  ${totals.period.slice(0, 7)} — Rp${formatIdr(totals.saku)}`);
  }

  lines.push(`Verifikasi laba bersih: ${matched}/${report.verification.length} cocok`);
  for (const v of report.verification) {
    const ok = Number.isFinite(v.diff) && Math.abs(v.diff) <= 1;
    lines.push(
      `  ${ok ? 'ok   ' : 'GAGAL'} ${v.period.slice(0, 7)} — impor ${formatIdr(v.computed)} ` +
        `vs sumber ${Number.isFinite(v.source) ? formatIdr(v.source) : 'tidak terbaca'} ` +
        `— selisih ${Number.isFinite(v.diff) ? formatIdr(v.diff) : '?'}`
    );
  }

  if (report.skipped.length > 0 || report.unknownLabels.length > 0) {
    lines.push('');
    lines.push('PERIKSA DULU: ada baris dilewati atau label tak dikenal.');
    lines.push('Jangan apply SQL ini sebelum keduanya dijelaskan.');
  }

  return { text: lines.join('\n'), failed };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let out = 'supabase/seed-ilj.sql';
  let startYear: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') out = argv[++i];
    else if (arg.startsWith('--out=')) out = arg.slice('--out='.length);
    else if (arg === '--start-year') startYear = Number(argv[++i]);
    else if (arg.startsWith('--start-year=')) startYear = Number(arg.slice('--start-year='.length));
    else positional.push(arg);
  }

  return { source: positional[0], out, startYear };
}

function main(): void {
  const { source, out, startYear } = parseArgs(process.argv.slice(2));

  if (!source) {
    console.error(
      'Pemakaian: npx tsx scripts/import-ilj.ts <path-xlsx> [--out FILE] [--start-year YYYY]'
    );
    process.exit(2);
  }

  const workbook = XLSX.read(readFileSync(source), { type: 'buffer', cellDates: false });
  const { periods, report } = importWorkbook(workbook, { startYear });
  const { text, failed } = buildReport(periods, report);

  console.log(text);

  /**
   * A failed verification writes nothing. The alternative — writing the file
   * with the failure noted in its header — leaves an applyable file sitting on
   * disk whose numbers are known to be wrong, and the header is exactly what
   * someone in a hurry skips.
   */
  if (failed) {
    console.error('');
    console.error(
      'Verifikasi laba bersih gagal. Tidak ada file yang ditulis — yang salah parsernya, ' +
        'bukan angkanya. Jangan sesuaikan angka agar cocok.'
    );
    process.exit(1);
  }

  writeFileSync(out, buildSql(periods, text, source), 'utf8');
  console.log('');
  console.log(`Ditulis: ${out}`);
  console.log('Tinjau isinya sebelum di-apply.');
}

/** Importing this file for tests must not run the CLI. */
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) main();
