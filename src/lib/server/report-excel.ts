/**
 * Laporan bulanan sebagai file Excel: template untuk diunduh, dan pembacaan
 * file yang diunggah kembali.
 *
 * Satu lembar "Laporan" dengan kolom Kode · Pos · Bagian · Jumlah (Rp) ·
 * Catatan, satu baris per pos template periode itu. Lembar tersembunyi
 * "_meta" menyimpan entitas, bulan, dan template, supaya file Oktober ILA
 * tidak terunggah ke September ILJ tanpa ada yang sadar.
 *
 * `exceljs`, bukan `xlsx`. SheetJS di npm membawa dua advisory yang tidak
 * ditambal di sana dan sengaja dilarang masuk aplikasi (lihat
 * scripts/import-ilj.ts); file ini menerima unggahan pengguna.
 *
 * Nominal keluar dari sini sebagai STRING dua desimal ("1897.50") dan
 * diteruskan apa adanya ke Postgres (invarian 3) — tidak ada penjumlahan.
 */

import ExcelJS from 'exceljs';

export interface ExcelLine {
  line_code: string;
  line_label: string;
  section_label: string;
  amount: string | number | null;
  note: string | null;
}

export interface ExcelMeta {
  entity: string;
  month: string;
  templateId: string;
}

export interface ParsedRow {
  line_code: string;
  /** "1897.50"; null = sel kosong, pos tidak diubah. */
  amount: string | null;
  /** null = sel kosong, catatan yang ada tidak diubah. */
  note: string | null;
  row: number;
}

export type ParseResult =
  | { ok: true; meta: ExcelMeta | null; rows: ParsedRow[] }
  | { ok: false; message: string };

const SHEET = 'Laporan';
const META = '_meta';
const HEADER = ['Kode', 'Pos', 'Bagian', 'Jumlah (Rp)', 'Catatan'];

/** Ukuran unggahan terbesar. Satu laporan bulanan jauh di bawah ini. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export async function buildWorkbook(
  title: string,
  meta: ExcelMeta,
  lines: ExcelLine[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Portal Keuangan';
  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 4 }] });

  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value =
    'Isi kolom Jumlah (Rp) saja. Jangan ubah kolom Kode. Sel Jumlah yang dikosongkan tidak mengubah pos itu.';
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF6B7280' } };

  const header = ws.getRow(4);
  header.values = HEADER;
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  });

  for (const line of lines) {
    const amount = line.amount === null || line.amount === '' ? null : Number(line.amount);
    const r = ws.addRow([line.line_code, line.line_label, line.section_label, amount, line.note ?? '']);
    r.getCell(4).numFmt = '#,##0.00';
    r.getCell(1).font = { color: { argb: 'FF6B7280' } };
  }

  ws.columns = [{ width: 18 }, { width: 34 }, { width: 22 }, { width: 20 }, { width: 40 }];

  const mws = wb.addWorksheet(META, { state: 'veryHidden' });
  mws.getCell('A1').value = 'entity';
  mws.getCell('B1').value = meta.entity;
  mws.getCell('A2').value = 'month';
  mws.getCell('B2').value = meta.month;
  mws.getCell('A3').value = 'template';
  mws.getCell('B3').value = meta.templateId;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Teks sel apa pun: string, angka, hasil rumus, rich text, hyperlink. */
function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v && typeof v === 'object') {
    if ('result' in v) return (v as ExcelJS.CellFormulaValue).result;
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return (v as ExcelJS.CellHyperlinkValue).text;
  }
  return v;
}

const asText = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

/**
 * Nominal dari sel. Angka Excel dibulatkan ke sen; teks dibaca dengan aturan
 * Indonesia — titik pemisah ribuan, koma desimal — sama seperti layar input,
 * tetapi desimalnya DIPERTAHANKAN, bukan dibuang. Null = kosong.
 */
export function readAmount(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false };
    return { ok: true, value: (Math.round(raw * 100) / 100).toFixed(2) };
  }
  let text = asText(raw).replace(/^rp\.?\s*/i, '').replace(/\s/g, '');
  if (text === '' || text === '-') return { ok: true, value: null };

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-') || text.startsWith('−')) {
    negative = true;
    text = text.slice(1);
  }

  let whole: string;
  let fraction = '';
  if (text.includes(',')) {
    // 1.500.000,50
    [whole, fraction = ''] = text.split(',');
    whole = whole.replace(/\./g, '');
  } else if ((text.match(/\./g) ?? []).length === 1 && /\.\d{1,2}$/.test(text)) {
    // 1500000.50 — satu titik dengan satu atau dua angka di belakangnya
    [whole, fraction] = text.split('.');
  } else {
    // 1.500.000 atau 1500000
    whole = text.replace(/\./g, '');
  }

  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) return { ok: false };
  const value = `${BigInt(whole)}.${fraction.padEnd(2, '0')}`;
  return { ok: true, value: negative && value !== '0.00' ? `-${value}` : value };
}

export async function parseWorkbook(data: ArrayBuffer | Buffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as ArrayBuffer);
  } catch {
    return { ok: false, message: 'File tidak dapat dibaca sebagai Excel (.xlsx).' };
  }

  const ws = wb.getWorksheet(SHEET) ?? wb.worksheets.find((s) => s.name !== META && s.state === 'visible');
  if (!ws) return { ok: false, message: 'File tidak punya lembar laporan.' };

  // Baris judul kolom: yang memuat "Kode" dan "Jumlah".
  let headerRow = 0;
  const col: Record<string, number> = {};
  ws.eachRow((row, n) => {
    if (headerRow) return;
    const found: Record<string, number> = {};
    row.eachCell((cell, c) => {
      const t = asText(cellValue(cell)).toLowerCase();
      if (t === 'kode') found.code = c;
      else if (t.startsWith('jumlah')) found.amount = c;
      else if (t === 'catatan') found.note = c;
    });
    if (found.code && found.amount) {
      headerRow = n;
      Object.assign(col, found);
    }
  });
  if (!headerRow) {
    return { ok: false, message: 'Kolom "Kode" dan "Jumlah (Rp)" tidak ditemukan. Gunakan template yang diunduh dari layar ini.' };
  }

  const rows: ParsedRow[] = [];
  const bad: number[] = [];
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const code = asText(cellValue(row.getCell(col.code))).toUpperCase();
    if (code === '') return;
    const amount = readAmount(cellValue(row.getCell(col.amount)));
    if (!amount.ok) {
      bad.push(n);
      return;
    }
    const note = col.note ? asText(cellValue(row.getCell(col.note))) : '';
    rows.push({ line_code: code, amount: amount.value, note: note === '' ? null : note, row: n });
  });

  if (bad.length > 0) {
    return { ok: false, message: `Nominal tidak terbaca di baris ${bad.join(', ')}. Isi angka saja, misalnya 1500000 atau 1.500.000,50.` };
  }

  const metaSheet = wb.getWorksheet(META);
  const meta = metaSheet
    ? {
        entity: asText(cellValue(metaSheet.getCell('B1'))),
        month: asText(cellValue(metaSheet.getCell('B2'))),
        templateId: asText(cellValue(metaSheet.getCell('B3')))
      }
    : null;

  return { ok: true, meta, rows };
}
