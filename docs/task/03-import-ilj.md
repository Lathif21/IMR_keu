# Fase 2 · Tugas 3 — Import Data Historis ILJ

Memasukkan 9 periode nyata (Nov 2024 – Jul 2025) dari
`Presentasi_Rekap_Income_Full_ILJ__Revisi_FIX.xlsx` ke `report_lines`.

**Tidak bergantung pada Tugas 1 dan 2.** Ini script, bukan layar — bisa
dikerjakan paralel, atau lebih dulu. Melakukannya lebih awal berarti Tugas 1
dan 2 diuji dengan data nyata, bukan seed yang sebagian dikarang.

Baca dulu: `CONTEXT.md` (kosakata), `ASSUMPTIONS.md` (A-2, A-4, A-9).

## Keluaran

```
scripts/import-ilj.ts          parser
supabase/seed-ilj.sql          hasil, di-commit dan ditinjau manual
```

Script **tidak menulis langsung ke database.** Ia menghasilkan SQL yang dibaca
manusia dulu. Data keuangan historis yang masuk diam-diam tanpa tinjauan
adalah cara paling cepat menanam angka salah yang tidak ketahuan berbulan-bulan.

Jalankan lewat `npx tsx scripts/import-ilj.ts <path-xlsx>`. Pakai `xlsx`
(SheetJS) sebagai devDependency.

## Struktur sumber

Workbook memuat 11 sheet. Yang dipakai hanya dua jenis:

**`DATABASE KPL`** — 362 baris, satu baris per invoice, Nov 2024 sampai
Jul 2025. Ini sumber pendapatan dan beban pokok.

| Kolom | Isi | Tujuan |
|---|---|---|
| B | Nomor invoice — `026/ILJ/JULI-2025` | penentu periode |
| H | TAGIHAN | `REV_TAGIHAN` |
| I | PAJAK | `COGS_PAJAK` |
| J | SAKU | lihat "Uang saku" di bawah |
| K | TERPAL | `COGS_TERPAL` |
| L | OPERASIONAL | `COGS_OPS` |
| M | REKANAN | `COGS_REKANAN` |

Kolom C (kapal), D (telly), E (lokasi), F (muatan), G (ritase) adalah data
operasional. Sistem ini tidak menyimpannya — abaikan.

Kolom N (PROFIT OPS) adalah subtotal. Jangan diimpor (invarian 2).

**Sheet bulanan** (`Nov 24` … `Jul 25`) — sumber beban usaha. Beban usaha
tidak ada di `DATABASE KPL`.

## Penentuan periode

Ambil dari **baris pemisah bulan**, bukan dari nomor invoice dan bukan dari
rentang baris yang di-hardcode di sheet.

`DATABASE KPL` memuat baris yang hanya berisi nama bulan di kolom B, tanpa
nilai apa pun. Semua baris di bawahnya milik bulan itu sampai pemisah
berikutnya:

```
NOVEMBER  DESEMBER  JANUARI  FEBRUARI  MARET  APRIL  MEI  JUNI  JULI
```

Cari pemisah secara dinamis — cocokkan kolom B terhadap daftar nama bulan
Indonesia saat seluruh kolom nilai kosong. Jangan hardcode nomor barisnya;
verifikasi posisinya saat dijalankan dan cetak di log.

**Kenapa bukan nomor invoice.** Tiga alasan, semuanya terverifikasi di file:

1. **Baris 207 salah tahun.** `06/ILJ/MARET/2024` seharusnya 2025. Parsing
   invoice melemparkannya ke Maret 2024 dan transaksi Rp4.935.040 hilang dari
   laporan. Pemisah bulan menanganinya otomatis.

2. **Format tidak konsisten.** `01/ILJ/NOVEMBER/2024` (slash),
   `026/ILJ/JULI-2025` (dash), `024/ILJ-JUNI-2025` (dash setelah ILJ).

3. **Nomor ganda.** `017B/JANUARI`, `08/FEBRUARI`, `011A/MARET`,
   `015B/APRIL`, `017B/MEI` masing-masing muncul dua kali. Jangan
   deduplikasi — jumlahkan keduanya dan catat di log. Menghapus salah satu
   berarti mengubah angka klien berdasarkan tebakan.

### Baris total — jebakan paling berbahaya

**Baris 362 adalah baris TOTAL, bukan transaksi.** Kolom B kosong, tapi
kolom H berisi 235.416.417 — persis jumlah H341:H359.

Kalau parser mengambilnya sebagai transaksi, **pendapatan Juli menjadi dua
kali lipat** dan tidak ada yang menandai kesalahan itu.

Aturannya: baris tanpa nomor invoice di kolom B **dilewati**, berapa pun
nilainya. Cetak di log setiap baris yang dilewati beserta nilainya, supaya
baris total terlihat sebagai baris total dan bukan data yang hilang.

### Baris kosong dan `#N/A`

Tiga baris benar-benar kosong: lewati diam-diam.

Baris 360 (`044/ILJ/JULI-2025`) punya nomor invoice, kapal, telly, dan muat
256,51 ton — tetapi TAGIHAN = 0 dan REKANAN = `#N/A`. Ini catatan yang belum
lengkap, bukan transaksi yang terlewat. Impor tetap memasukkannya sebagai nol
dan mencatatnya di log; dampaknya terhadap angka nihil, tetapi
keberadaannya perlu terlihat.

Perlakukan `#N/A` sebagai nol, jangan sebagai error.

## Beban usaha dari sheet bulanan

Blok "Laporan Laba Rugi" **berpindah posisi setiap bulan**. Kolomnya berturut-
turut `Z, Z, AC, Z, T, W, U, X, L`, dan baris "Pendapatan Bersih" kadang di
26, kadang 27.

Jangan gunakan koordinat sel tetap. Untuk tiap sheet:

1. Pindai seluruh sel, cari yang memuat teks `Laporan Laba Rugi`
2. Dari situ turun, baca pasangan label–nilai di kolom sebelah kanan
3. Berhenti di label yang mengandung `Pendapatan Bersih` atau `Laba Bersih`

Petakan label ke `line_code`:

| Label sumber (kira-kira) | line_code |
|---|---|
| Gaji Karyawan | `OPEX_GAJI` |
| Sewa Kantor | `OPEX_SEWA` |
| Beban Kantor, ATK | `OPEX_ATK` |
| Konsultan, notaris, fee pajak | `OPEX_PROF` |
| Perizinan, retribusi | `OPEX_PERIZINAN` |
| sisanya | `OPEX_LAIN` |

Pencocokan berbasis substring, huruf kecil. **Label yang tidak cocok jangan
dimasukkan ke `OPEX_LAIN` secara diam-diam** — catat di laporan dengan nama
sheet dan koordinat selnya, lalu tambahkan aturannya secara manual. Beban yang
diam-diam masuk keranjang "lain-lain" adalah cara laporan kehilangan makna.

## Uang saku — jangan diputuskan

Kolom J memuat Rp103.985.000 untuk Juli 2025, dan **sheet aslinya tidak
memasukkannya ke laporan laba rugi sama sekali** (`M13 = SUM(M9:M12)`,
tidak mencakup saku).

Parser mereproduksi apa yang mereka laporkan:

- `COGS_SAKU` diisi **0**
- Nilai sebenarnya ditulis ke kolom `note` baris itu:
  `"Sumber mencatat Rp103.985.000 di luar laba rugi — ASSUMPTIONS.md A-2"`
- Total seluruh saku per periode masuk laporan hasil parsing

Alasannya: A-2 belum diputuskan. Memasukkan angkanya berarti parser memilih
kebijakan akuntansi (melanggar invarian 8); menghilangkannya sepenuhnya
berarti menyembunyikan lubang Rp104 juta. Yang benar adalah mereproduksi
laporan mereka sambil menampilkan selisihnya.

Terpal diperlakukan sama bila sumbernya mencatat 50% — impor apa adanya,
catat di `note`.

## Verifikasi

Untuk setiap periode, hitung laba bersih dari baris yang diimpor dan
bandingkan dengan angka di sheet sumber.

Juli 2025 harus menghasilkan **−2.178.807**. Kalau meleset, parser salah —
jangan sesuaikan angkanya agar cocok.

Selisih di atas Rp1 dilaporkan sebagai kegagalan, bukan peringatan.

## Laporan hasil parsing

Cetak ke stdout, dan simpan sebagai komentar di kepala `seed-ilj.sql`:

```
Periode diproses      : 9
Invoice diproses      : 3xx
Invoice dilewati      : n  (daftar nomor + alasan)
Label opex tak dikenal: n  (sheet, sel, teks)
Uang saku di luar L/R : Rp x per periode
Verifikasi laba bersih: 9/9 cocok
```

Kalau ada baris "dilewati" atau "tak dikenal", jangan langsung apply SQL-nya.

## Bentuk SQL

Ikuti pola `supabase/seed.sql`: bungkus dalam transaksi, jalankan lewat JWT
impersonation supaya trigger ikut berjalan dan `audit_log.actor_id` terisi.

Per periode:

1. Insert `periods` — status `draft` (dipaksa `guard_period_insert`),
   `template_id` dari template trucking aktif
2. Insert `report_lines` — hanya baris yang nilainya bukan 0 atau ada catatan
3. Naikkan status ke `submitted` lalu `approved` lewat UPDATE terpisah, karena
   `guard_period_transition` hanya mengizinkan satu langkah sekali jalan
4. Jangan `locked` — biarkan bisa dikoreksi setelah A-2 terjawab

Pengaju dan penyetuju harus user berbeda, atau pemisahan tugas menolaknya.

## Selesai bila

- [ ] `npx tsx scripts/import-ilj.ts <file>` menghasilkan `seed-ilj.sql`
- [ ] 9 periode, laba bersih cocok seluruhnya dengan sumber
- [ ] Juli 2025 = −2.178.807
- [ ] Pendapatan Juli = 235.416.417, **bukan** 470.832.834 — bukti baris total
      di baris 362 tidak ikut terimpor
- [ ] Baris 207 (`06/ILJ/MARET/2024`) masuk ke Maret 2025 — bukti pemisah
      bulan dipakai, bukan nomor invoice
- [ ] Invoice `044/ILJ/JULI-2025` terimpor bernilai nol dan tercatat di log
- [ ] Lima nomor invoice ganda seluruhnya terjumlah, tidak ada yang terbuang
- [ ] Rekanan ≈ 83% dari tagihan di setiap periode (`CONTEXT.md`)
- [ ] Tidak ada label opex yang tak dikenal, atau semuanya sudah dipetakan
- [ ] `psql -f seed-ilj.sql` jalan tanpa error setelah `npm run db:reset`
- [ ] Dasbor menampilkan 9 periode; perbandingan MoM terisi di 8 di antaranya
- [ ] `v_period_comparison` mengembalikan `revenue_yoy_pct` kosong di semua
      baris — rentangnya belum 12 bulan. Ini benar, bukan bug.

## Ditunda

| Hal | Alasan |
|---|---|
| Import tiga entitas lain | Belum ada filenya |
| Import ulang idempoten | Sekali jalan. `db:reset` mengulang dari nol |
| Data operasional (muatan, ritase) | Di luar lingkup sistem ini |
| Rekonsiliasi "Rincian Pengeluaran" (kolom AH) | Selisih Rp112,8 juta terhadap L/R belum bisa direkonsiliasi. Itu temuan untuk akuntan, bukan pekerjaan parser |
