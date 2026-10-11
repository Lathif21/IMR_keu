/**
 * `src/lib/server/report-excel.ts`: template Excel laporan bulanan dan
 * pembacaan file unggahan. Tanpa database.
 *
 * Yang dijaga: nominal yang bergeser (desimal dibuang, ribuan terbaca
 * desimal), file periode lain yang masuk diam-diam, dan sel kosong yang
 * terbaca sebagai nol.
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildWorkbook, parseWorkbook, readAmount } from '$lib/server/report-excel';

const META = { entity: 'ILA', month: '2026-10', templateId: 't-1' };

async function template() {
  return buildWorkbook('Laporan Laba Rugi — PT ILA — Oktober 2026', META, [
    { line_code: 'REV_USAHA', line_label: 'Pendapatan Usaha', section_label: 'Pendapatan', amount: '1500000.50', note: null },
    { line_code: 'COGS_POKOK', line_label: 'Beban Pokok', section_label: 'Beban Pokok', amount: null, note: 'catatan lama' },
    { line_code: 'OPEX_GAJI', line_label: 'Gaji Karyawan', section_label: 'Beban Usaha', amount: null, note: null }
  ]);
}

/** Ubah sel Jumlah/Catatan seperti orang mengisi di Excel. */
async function isi(buffer: Buffer, perubahan: Record<number, [unknown, unknown?]>) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Laporan')!;
  for (const [row, [amount, note]] of Object.entries(perubahan)) {
    ws.getCell(Number(row), 4).value = amount as ExcelJS.CellValue;
    if (note !== undefined) ws.getCell(Number(row), 5).value = note as ExcelJS.CellValue;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('readAmount', () => {
  it('angka Excel dibulatkan ke sen, tanpa membuang desimal', () => {
    expect(readAmount(1897.5)).toEqual({ ok: true, value: '1897.50' });
    expect(readAmount(1500000)).toEqual({ ok: true, value: '1500000.00' });
  });

  it('teks gaya Indonesia: titik ribuan, koma desimal', () => {
    expect(readAmount('1.500.000')).toEqual({ ok: true, value: '1500000.00' });
    expect(readAmount('1.500.000,50')).toEqual({ ok: true, value: '1500000.50' });
    expect(readAmount('Rp 1.500')).toEqual({ ok: true, value: '1500.00' });
    expect(readAmount('1500000.5')).toEqual({ ok: true, value: '1500000.50' });
  });

  it('negatif, termasuk kurung akuntansi', () => {
    expect(readAmount('-2.000')).toEqual({ ok: true, value: '-2000.00' });
    expect(readAmount('(2.000)')).toEqual({ ok: true, value: '-2000.00' });
  });

  /** Kosong berarti "tidak diubah", bukan nol. */
  it('sel kosong atau strip adalah null, bukan nol', () => {
    expect(readAmount(null)).toEqual({ ok: true, value: null });
    expect(readAmount('')).toEqual({ ok: true, value: null });
    expect(readAmount('-')).toEqual({ ok: true, value: null });
    expect(readAmount(0)).toEqual({ ok: true, value: '0.00' });
  });

  it('menolak teks yang bukan angka dan desimal lebih dari dua', () => {
    expect(readAmount('satu juta').ok).toBe(false);
    expect(readAmount('1.500,555').ok).toBe(false);
  });
});

describe('buildWorkbook → parseWorkbook', () => {
  it('template bolak-balik membawa kode, nominal, catatan, dan meta', async () => {
    const hasil = await parseWorkbook(await template());
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(hasil.meta).toEqual(META);
    expect(hasil.rows.map((r) => [r.line_code, r.amount, r.note])).toEqual([
      ['REV_USAHA', '1500000.50', null],
      ['COGS_POKOK', null, 'catatan lama'],
      ['OPEX_GAJI', null, null]
    ]);
  });

  it('membaca angka yang diisi pengguna, termasuk teks dan rumus', async () => {
    const file = await isi(await template(), {
      6: [{ formula: '1000+250', result: 1250 }],
      7: ['2.500.000', 'gaji Oktober']
    });
    const hasil = await parseWorkbook(file);
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;
    expect(hasil.rows.find((r) => r.line_code === 'COGS_POKOK')?.amount).toBe('1250.00');
    expect(hasil.rows.find((r) => r.line_code === 'OPEX_GAJI')).toMatchObject({ amount: '2500000.00', note: 'gaji Oktober' });
  });

  it('menolak file dengan nominal yang tidak terbaca, menyebut barisnya', async () => {
    const hasil = await parseWorkbook(await isi(await template(), { 7: ['dua juta'] }));
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.message).toContain('baris 7');
  });

  it('menolak file yang bukan Excel', async () => {
    const hasil = await parseWorkbook(Buffer.from('bukan excel'));
    expect(hasil.ok).toBe(false);
  });

  it('menolak file tanpa kolom Kode dan Jumlah', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['Nama', 'Nilai']);
    const hasil = await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(hasil.ok).toBe(false);
  });
});
