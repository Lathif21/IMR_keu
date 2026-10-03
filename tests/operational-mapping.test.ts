/**
 * Bentuk respons sistem operasional dan pemetaan biaya ke pos laporan.
 *
 * Tanpa database: `parseRekap` dan `petakanBiaya` adalah fungsi murni, dan
 * dua kegagalan yang dijaga di sini tidak butuh Postgres untuk terlihat —
 * nominal yang lewat float, dan biaya yang masuk pos tanpa ada yang tahu.
 *
 * Seluruh angka di bawah adalah data dummy.
 */

import { describe, expect, it } from 'vitest';
import {
  POS_BELUM_DIPETAKAN,
  parseRekap,
  petakanBiaya,
  type BiayaJenis,
  type PemetaanBiaya
} from '../src/routes/(app)/entry/[period]/operational';

describe('parseRekap', () => {
  const lengkap = {
    periode: '2026-08',
    dihitung_pada: '2026-09-20T10:00:00+07:00',
    baris: {
      REV_TAGIHAN: '241500000.00',
      COGS_SAKU: '0.00',
      COGS_TELLY: '3200000.00',
      COGS_PAGUYUBAN: '750000.00'
    },
    biaya_per_jenis: [
      { sumber: 'pengeluaran', jenis: 'Sewa Kantor', jumlah: '1500000.00', baris: 1 },
      { sumber: 'honor_telly', jenis: 'Gaji Admin Bulanan', jumlah: '5000000.00', baris: 2 }
    ],
    rute_rekap_saja: [],
    jumlah_sumber: { invoice: 26, transaksi: 140, gaji_admin: 2 }
  };

  it('menerima respons yang sah', () => {
    const hasil = parseRekap(lengkap);
    expect(hasil.ok).toBe(true);
    if (hasil.ok) {
      expect(hasil.rekap.baris.REV_TAGIHAN).toBe('241500000.00');
      expect(hasil.rekap.baris.COGS_TELLY).toBe('3200000.00');
      expect(hasil.rekap.baris.COGS_PAGUYUBAN).toBe('750000.00');
      expect(hasil.rekap.biaya_per_jenis).toHaveLength(2);
      expect(hasil.rekap.jumlah_sumber.invoice).toBe(26);
    }
  });

  /**
   * Angka JSON sudah melewati float saat diurai, jadi menerimanya berarti
   * menerima nilai yang mungkin sudah bergeser.
   */
  it('menolak nominal yang dikirim sebagai angka, bukan teks', () => {
    const hasil = parseRekap({ ...lengkap, baris: { REV_TAGIHAN: 241500000 } });
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.message).toMatch(/bukan sebagai teks/);
  });

  it('menolak nominal biaya yang dikirim sebagai angka', () => {
    const hasil = parseRekap({
      ...lengkap,
      biaya_per_jenis: [{ sumber: 'pengeluaran', jenis: 'Sewa Kantor', jumlah: 1500000, baris: 1 }]
    });
    expect(hasil.ok).toBe(false);
  });

  /** Tiga desimal hanya bisa muncul kalau pengirim sempat memakai float. */
  it('menolak nominal dengan lebih dari dua desimal', () => {
    expect(parseRekap({ ...lengkap, baris: { REV_TAGIHAN: '1.005' } }).ok).toBe(false);
  });

  it('menolak notasi eksponen', () => {
    expect(parseRekap({ ...lengkap, baris: { REV_TAGIHAN: '2.415e8' } }).ok).toBe(false);
  });

  it('menolak respons tanpa daftar baris', () => {
    expect(parseRekap({ periode: '2026-08' }).ok).toBe(false);
    expect(parseRekap('bukan objek').ok).toBe(false);
  });

  /**
   * Sistem operasional versi lama tidak mengirim `biaya_per_jenis`. Menerima
   * responsnya berarti pengeluaran bulan itu hilang dari laporan tanpa pesan.
   */
  it('menolak respons tanpa rincian biaya per jenis', () => {
    const { biaya_per_jenis: _, ...lama } = lengkap;
    const hasil = parseRekap(lama);
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.message).toMatch(/perlu diperbarui/);
  });

  /** Pos OPEX dari sana + hasil pemetaan di sini = pengeluaran dihitung dua kali. */
  it('menolak pos OPEX yang sudah dipetakan di sistem operasional', () => {
    const hasil = parseRekap({ ...lengkap, baris: { ...lengkap.baris, OPEX_GAJI: '9500000.00' } });
    expect(hasil.ok).toBe(false);
  });

  it('menolak sumber biaya yang tidak dikenal', () => {
    const hasil = parseRekap({
      ...lengkap,
      biaya_per_jenis: [{ sumber: 'kas_kecil', jenis: 'ATK', jumlah: '1.00', baris: 1 }]
    });
    expect(hasil.ok).toBe(false);
  });

  /** Bidang peringatan yang hilang tidak menjatuhkan tarik data. */
  it('memperlakukan rute_rekap_saja yang hilang sebagai kosong', () => {
    const hasil = parseRekap({ baris: { REV_TAGIHAN: '1.00' }, biaya_per_jenis: [] });
    expect(hasil.ok).toBe(true);
    if (hasil.ok) expect(hasil.rekap.rute_rekap_saja).toEqual([]);
  });
});

describe('petakanBiaya', () => {
  const operasional = { REV_TAGIHAN: '241500000.00', COGS_TELLY: '3200000.00' };

  const biaya: BiayaJenis[] = [
    { sumber: 'pengeluaran', jenis: 'Gaji Staf', jumlah: '9000000.00', baris: 1 },
    { sumber: 'pengeluaran', jenis: 'Bonus Staf', jumlah: '500000.50', baris: 1 },
    { sumber: 'pengeluaran', jenis: 'Sewa Kantor', jumlah: '1500000.00', baris: 1 },
    { sumber: 'pengeluaran', jenis: 'Retribusi Baru', jumlah: '750000.00', baris: 2 },
    { sumber: 'honor_telly', jenis: 'Gaji Admin Bulanan', jumlah: '5000000.00', baris: 2 }
  ];

  const pemetaan: PemetaanBiaya[] = [
    { source: 'pengeluaran', jenis: 'Gaji Staf', line_code: 'OPEX_GAJI' },
    { source: 'pengeluaran', jenis: 'Bonus Staf', line_code: 'OPEX_GAJI' },
    { source: 'pengeluaran', jenis: 'Sewa Kantor', line_code: 'OPEX_SEWA' },
    { source: 'honor_telly', jenis: 'Gaji Admin Bulanan', line_code: null },
    // Dipetakan tetapi tidak ada biayanya bulan ini.
    { source: 'pengeluaran', jenis: 'ATK', line_code: 'OPEX_ATK' }
  ];

  it('menjumlahkan jenis yang dipetakan ke pos yang sama, tanpa float', () => {
    const { baris } = petakanBiaya(operasional, biaya, pemetaan);
    expect(baris.OPEX_GAJI).toBe('9500000.50');
    expect(baris.OPEX_SEWA).toBe('1500000.00');
  });

  /** Keputusan 4 Oktober 2026: tidak memblokir, tetapi tidak juga diam. */
  it('memasukkan jenis tanpa pemetaan ke Beban Operasional Lain dan menyebutnya', () => {
    const { baris, belumDipetakan } = petakanBiaya(operasional, biaya, pemetaan);
    expect(POS_BELUM_DIPETAKAN).toBe('OPEX_LAIN');
    expect(baris.OPEX_LAIN).toBe('750000.00');
    expect(belumDipetakan.map((b) => b.jenis)).toEqual(['Retribusi Baru']);
  });

  /**
   * Gaji admin di Honor Telly yang dipetakan "tidak ditarik" tidak masuk pos
   * mana pun, sehingga tidak terhitung dua kali dengan pengeluaran gaji.
   */
  it('melewati jenis yang dipetakan "tidak ditarik" dan menyebutnya', () => {
    const { baris, tidakDitarik } = petakanBiaya(operasional, biaya, pemetaan);
    expect(tidakDitarik.map((b) => b.jenis)).toEqual(['Gaji Admin Bulanan']);
    expect(baris.OPEX_GAJI).toBe('9500000.50');
    expect(baris.OPEX_LAIN).toBe('750000.00');
  });

  it('dapat mengambil gaji admin dari Honor Telly bila itu yang dipilih', () => {
    const pilihTelly: PemetaanBiaya[] = [
      { source: 'pengeluaran', jenis: 'Gaji Staf', line_code: null },
      { source: 'pengeluaran', jenis: 'Bonus Staf', line_code: null },
      { source: 'honor_telly', jenis: 'Gaji Admin Bulanan', line_code: 'OPEX_GAJI' }
    ];
    const { baris } = petakanBiaya(operasional, biaya, pilihTelly);
    expect(baris.OPEX_GAJI).toBe('5000000.00');
  });

  /** Nol berarti sudah dihitung; kode yang tidak ditulis membiarkan angka lama berdiri. */
  it('menulis nol untuk pos yang dipetakan tetapi kosong bulan ini', () => {
    const { baris } = petakanBiaya(operasional, [], pemetaan);
    expect(baris.OPEX_ATK).toBe('0.00');
    expect(baris.OPEX_LAIN).toBe('0.00');
    expect(baris).not.toHaveProperty('OPEX_PROF');
  });

  it('membiarkan baris operasional apa adanya', () => {
    const { baris } = petakanBiaya(operasional, biaya, pemetaan);
    expect(baris.REV_TAGIHAN).toBe('241500000.00');
    expect(baris.COGS_TELLY).toBe('3200000.00');
  });

  /** Pemetaan ke pos yang juga diisi sistem operasional menambah, tidak menimpa. */
  it('menambahkan ke pos yang sudah berisi angka operasional', () => {
    const { baris } = petakanBiaya(
      operasional,
      [{ sumber: 'pengeluaran', jenis: 'Upah Telly Tambahan', jumlah: '0.01', baris: 1 }],
      [{ source: 'pengeluaran', jenis: 'Upah Telly Tambahan', line_code: 'COGS_TELLY' }]
    );
    expect(baris.COGS_TELLY).toBe('3200000.01');
  });

  /** Jenis dicocokkan persis, seperti di sisi Laravel. */
  it('membedakan sumber dan besar-kecil huruf jenis', () => {
    const { belumDipetakan } = petakanBiaya(
      {},
      [
        { sumber: 'pengeluaran', jenis: 'sewa kantor', jumlah: '1.00', baris: 1 },
        { sumber: 'pengeluaran', jenis: 'Gaji Admin Bulanan', jumlah: '1.00', baris: 1 }
      ],
      pemetaan
    );
    expect(belumDipetakan.map((b) => b.jenis)).toEqual(['sewa kantor', 'Gaji Admin Bulanan']);
  });

  /** Angka besar yang membuat float meleset satu sen. */
  it('tetap tepat untuk nominal besar', () => {
    const { baris } = petakanBiaya(
      {},
      [
        { sumber: 'pengeluaran', jenis: 'A', jumlah: '200444999.99', baris: 1 },
        { sumber: 'pengeluaran', jenis: 'B', jumlah: '0.01', baris: 1 },
        { sumber: 'pengeluaran', jenis: 'C', jumlah: '99999999999999.99', baris: 1 }
      ],
      [
        { source: 'pengeluaran', jenis: 'A', line_code: 'OPEX_SEWA' },
        { source: 'pengeluaran', jenis: 'B', line_code: 'OPEX_SEWA' },
        { source: 'pengeluaran', jenis: 'C', line_code: 'OPEX_PROF' }
      ]
    );
    expect(baris.OPEX_SEWA).toBe('200445000.00');
    expect(baris.OPEX_PROF).toBe('99999999999999.99');
  });

  it('menangani nominal negatif (koreksi)', () => {
    const { baris } = petakanBiaya(
      {},
      [
        { sumber: 'pengeluaran', jenis: 'A', jumlah: '100.00', baris: 1 },
        { sumber: 'pengeluaran', jenis: 'Koreksi A', jumlah: '-150.25', baris: 1 }
      ],
      [
        { source: 'pengeluaran', jenis: 'A', line_code: 'OPEX_ATK' },
        { source: 'pengeluaran', jenis: 'Koreksi A', line_code: 'OPEX_ATK' }
      ]
    );
    expect(baris.OPEX_ATK).toBe('-50.25');
  });
});
