# Fase 2 · Tugas 5 — Tes Regresi Otomatis

Mengubah bagian paling mahal dari `TESTING.md` dan `TESTING-WORKFLOW.md`
menjadi tes yang bisa dijalankan satu perintah.

Kerjakan setelah Tugas 3 dan 4, supaya yang diotomasi adalah perilaku yang
sudah final.

## Kenapa sekarang

Dokumen uji manual sudah 1.705 baris dan harus dijalankan ulang setiap kali
schema atau alur berubah. Pada 20 jam/minggu, itu memakan sebagian besar waktu
yang tersedia untuk pekerjaan sebenarnya — dan yang lebih berbahaya, checklist
panjang cenderung dilewati justru saat perubahannya besar.

Ini bukan penambahan lapisan. Ini memindahkan pekerjaan yang sudah dilakukan
manual ke tempat yang lebih murah.

## Lingkup

**Otomasikan** yang gagalnya menghasilkan laporan keuangan salah:

- Isolasi RLS antar entitas dan antar peran
- Trigger alur kerja: transisi status, pemisahan tugas, periode terkunci
- `guard_line_code_in_template` dan `guard_period_insert`
- Audit log append-only dan atribusi aktor
- Aritmetika view: `v_period_pnl`, `v_group_consolidated`, `v_period_comparison`
- Eliminasi antar-perusahaan
- Parsing dan pemformatan angka di `format.ts`

**Biarkan manual** yang butuh mata:

- Tata letak, urutan fokus, perilaku keyboard di tabel input
- Rendering di browser
- Apakah angkanya angka klien yang benar

`TESTING-WORKFLOW.md` Bagian I sudah memisahkan ini dengan benar. Pertahankan
bagian itu sebagai checklist manual; sisanya diotomasi.

## Perkakas

```
vitest              unit + integrasi
@vitest/coverage-v8 opsional
```

Jangan tambahkan Playwright sekarang. Yang tersisa manual adalah hal yang
memang butuh penilaian manusia; Playwright akan menambah perkakas tanpa
menghapus pekerjaan.

Tes berjalan terhadap stack Supabase lokal yang sudah ada. Jangan bikin
harness database terpisah.

```json
"test": "vitest run",
"test:watch": "vitest"
```

## Struktur

```
tests/
  helpers.ts          klien per peran, reset fixture
  rls.test.ts         siapa melihat apa
  workflow.test.ts    transisi status, pemisahan tugas, kunci
  guards.test.ts      line_code, insert periode, audit immutable
  views.test.ts       aritmetika, eliminasi, kelengkapan
  format.test.ts      unit murni, tanpa database
```

Enam file. Jangan pecah lebih jauh — cari tes berdasarkan nama file, bukan
lewat pohon direktori.

## `helpers.ts`

Satu fungsi mengembalikan klien Supabase terautentikasi per peran seed:

```ts
signIn('direksi' | 'manajer' | 'staf.ilj' | 'auditor')
```

Kredensialnya dari `supabase/seed.sql` — lokal saja, dan sudah tercetak di
`README.md`. Jangan duplikasi di file tes; baca dari env dengan default.

Untuk operasi yang perlu melewati RLS (menyiapkan fixture), pakai service
role key dari `.env`. Trigger tetap berjalan.

**Reset antar file, bukan antar tes.** `db:reset` lambat. Jalankan sekali di
`beforeAll` tiap file, dan rancang tes dalam satu file agar tidak saling
merusak. Kalau sebuah tes butuh fixture bersih sendiri, itu tanda tesnya
terlalu besar.

## Yang harus ditegaskan tiap file

### `rls.test.ts`

- Staf ILJ tidak dapat membaca `periods` entitas lain
- Staf ILJ tidak dapat membaca `report_lines` entitas lain lewat `period_id`
- Auditor dapat membaca semuanya, tidak dapat menulis apa pun
- Staf entitas tidak dapat membaca `intercompany_transactions`
- Profil nonaktif tidak mendapat apa-apa — `current_user_role()`
  mengembalikan NULL

Penolakan RLS muncul sebagai hasil kosong, bukan error. Uji jumlah baris,
jangan uji lemparan error.

### `workflow.test.ts`

- Setiap transisi sah berhasil
- Setiap transisi tidak sah ditolak
- Pengaju tidak dapat menyetujui pekerjaannya sendiri
- Penolakan tanpa catatan ditolak
- Hanya direksi yang dapat membuka kunci
- Periode terkunci menolak perubahan baris

### `guards.test.ts`

- `line_code` di luar template ditolak
- Periode baru selalu lahir `draft` meski dikirim `approved`
- Kolom jejak alur kerja pada INSERT ditimpa null
- `audit_log` menolak UPDATE dan DELETE
- Setiap perubahan menghasilkan baris audit dengan `actor_id` terisi

### `views.test.ts`

Yang paling penting, karena kegagalannya senyap.

- `gross_profit = revenue − cogs` pada data ILJ nyata
- `net_profit` Juli 2025 = −2.178.807
- Baris dengan `line_code` tak dikenal tidak dapat masuk sama sekali
  (dijaga trigger) — pastikan tidak ada jalur lain
- `v_group_consolidated`: `revenue_consolidated = revenue_sum − elimination`
- Entitas berstatus `draft` atau `submitted` **tidak** masuk konsolidasi
- `is_complete` false dan `missing_entities` terisi saat ada yang belum lapor
- `revenue_mom_pct` membandingkan bulan sebelumnya, bukan tahun sebelumnya —
  uji dengan dua periode yang nilainya sengaja dibuat berbeda
- `revenue_yoy_pct` kosong bila belum ada data 12 bulan sebelumnya

### `format.test.ts`

Tanpa database. Cepat, jalankan sesering mungkin.

- `toAmount` menerima string maupun number dari PostgREST
- Nilai negatif tampil dalam kurung
- Input `1.500.000` dan `1500000` menghasilkan angka yang sama
- Kosong menghasilkan 0, bukan null
- `clampPct` menahan di 0–100
- `previousPeriod` menyeberangi batas tahun dengan benar
- `NO_DATA` dipakai untuk null, bukan untuk nol

## Setelah selesai

Pangkas `TESTING.md` dan `TESTING-WORKFLOW.md` menjadi bagian yang benar-benar
masih manual. Menyimpan checklist untuk hal yang sudah diotomasi berarti dua
sumber kebenaran, dan yang manual akan lebih dulu basi.

Tambahkan di bagian atas kedua file: perintah untuk menjalankan tes otomatis,
dan pernyataan bahwa checklist ini hanya mencakup sisanya.

## Selesai bila

- [ ] `npm test` hijau dari fixture bersih
- [ ] Seluruh rangkaian selesai di bawah 60 detik
- [ ] Menghapus satu trigger di migration membuat tes gagal — buktikan,
      jangan asumsikan
- [ ] Dua dokumen uji manual sudah dipangkas dan tidak tumpang tindih
- [ ] `README.md` menyebut `npm test`

## Ditunda

| Hal | Alasan |
|---|---|
| CI di GitHub Actions | Butuh Supabase di runner. Jalankan lokal dulu sampai rangkaiannya stabil |
| Tes browser (Playwright) | Sisa yang manual memang butuh mata manusia |
| Coverage threshold | Angka cakupan mendorong tes yang menaikkan angka, bukan tes yang menangkap bug |
| Tes konkurensi | Masih ditunda dengan alasan yang sama: empat entitas, satu manajer |
