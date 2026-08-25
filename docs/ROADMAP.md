# Roadmap

Status per 24 Agustus 2026. Fase 1 selesai. Fase 2 selesai kecuali impor data
ILJ, yang menunggu file dari klien. Fase 3 selesai kecuali layar
antar-perusahaan.

## Sudah ada

| | Status |
|---|---|
| Schema, RLS, trigger, audit, 4 view | ✅ |
| Auth, sesi, guard rute | ✅ |
| Dasbor Eksekutif | ✅ |
| Input Laporan (`/entry`) | ✅ |
| Persetujuan (`/approval`) | ✅ |
| Laporan P&L (`/entities`) | ✅ |
| Layar admin: entitas, template, pengguna | ✅ |
| Tes regresi otomatis (`npm test`) | ✅ |
| Parser impor ILJ (`scripts/import-ilj.ts`) | ✅ ditulis, ⛔ belum dijalankan |
| Checklist uji manual | ✅ dipangkas 1.705 → 1.341 baris |

Sistem sudah bisa menjalankan satu siklus bulanan penuh: buat periode, isi,
ajukan, tolak, perbaiki, setujui, kunci — lalu membacanya kembali sebagai
laporan laba rugi. Sidebar tidak lagi punya item yang disabled.

## Yang belum ada

| Hal | Dampak |
|---|---|
| **Data ILJ asli (9 bulan)** | Parser siap, workbook-nya tidak ada di repo. Seed masih sebagian dikarang; YoY tak bisa diuji |
| Pencatatan tiga kebijakan sisanya | `uang_saku_treatment`, `profit_sharing_65_35`, `accounting_standard` belum punya layar |
| Registry transaksi antar-perusahaan | Tabel ada, layar tidak |
| Ekspor Excel/PDF | R-12 |
| Import CSV | R-04 |
| Target deploy | Masih `adapter-auto` |
| Strategi backup | Belum ada di repo |

## Fase 2 — Data nyata & jalur baca · selesai sebagian

| Tugas | Status |
|---|---|
| 3 · `task/03-import-ilj.md` — parser Excel → 9 periode nyata | Parser selesai dan teruji. **Menunggu `Presentasi_Rekap_Income_Full_ILJ__Revisi_FIX.xlsx`** |
| 4 · `task/04-pnl-screen.md` — Laporan P&L | Selesai |
| 5 · `task/05-regression-tests.md` — tes otomatis | Selesai — 125 assertion, 4 detik |

### Yang tersisa dari Tugas 3

Workbook sumber tidak ada di repo maupun di sekitarnya. Yang sudah ada:

- `scripts/import-ilj.ts` — pemisah bulan dinamis, baris total dilewati,
  invoice ganda dijumlahkan, `#N/A` jadi nol, blok laba rugi dicari lewat
  teksnya, uang saku masuk `note` bukan angka, verifikasi laba bersih per
  periode dengan toleransi Rp1.
- `tests/import-ilj.test.ts` — workbook sintetis yang memuat setiap jebakan
  yang didokumentasikan: baris total yang menggandakan pendapatan Juli, baris
  bertahun salah, lima nomor ganda, `#N/A`, blok yang berpindah kolom tiap
  bulan. 35 assertion.

Begitu filenya ada:

```sh
npx tsx scripts/import-ilj.ts <path-xlsx>   # menghasilkan supabase/seed-ilj.sql
# baca laporan parsingnya, lalu:
npm run db:reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 \
     -f supabase/seed-ilj.sql
npm test
```

Parser menolak menulis file bila verifikasi laba bersih meleset lebih dari Rp1.
Yang salah parsernya, bukan angkanya — jangan sesuaikan angka agar cocok.

`seed-ilj.sql` yang dihasilkan menghapus dulu periode ILJ karangan dari
`supabase/seed.sql`, karena keduanya bertabrakan di indeks unik
`(entity_id, period)`. Setelah data nyata masuk, `seed.sql` sebaiknya dipangkas
supaya tidak ada dua sumber angka ILJ.

## Temuan yang diperbaiki sambil jalan

**Profil nonaktif tidak mencabut apa pun.** `has_entity_access()` hanya membaca
`user_entity_access` dan tidak pernah melihat `profiles.is_active`, sehingga
akun `staf_entitas` yang sudah dinonaktifkan masih dapat membaca laporan
entitasnya, **menyisipkan baris laporan**, dan mengajukan periode. Ditemukan
oleh `tests/rls.test.ts`; ditutup oleh
`migrations/20250102000000_revoke_inactive_profiles.sql`. `is_readonly_role()`
sekaligus diubah jadi gagal-tertutup untuk peran yang tidak dikenal.

Ini persis alasan tes otomatis dijadwalkan sekarang, bukan nanti: lubangnya ada
sejak migrasi pertama dan tidak terlihat oleh 1.705 baris checklist manual.

## Fase 3 — Layar admin · selesai

| Tugas | Status |
|---|---|
| 6 · `task/06-admin-migration.md` — migration pendahulu | Selesai |
| 7 · `task/07-admin-entities.md` — layar entitas | Selesai |
| 8 · `task/08-admin-templates.md` — layar template | Selesai |
| 9 · `task/09-admin-users.md` — layar pengguna | Selesai |

```
/admin/entities      buat & ubah entitas, tetapkan basis pelaporan lewat RPC
/admin/templates     template berversi, editor baris, pratinjau
/admin/users         profil, peran, penautan user_entity_access, reset password
```

Ketiganya di balik `/admin/+layout.server.ts` yang menolak selain `direksi`.

**Sebagian `/admin/policies` sudah terjawab.** Basis pelaporan — dua dari lima
kebijakan terbuka — kini punya jalur pencatatan yang benar: `reporting_basis`
dan `revenue_presentation` hanya dapat diubah lewat
`set_entity_reporting_basis()`, yang menulis alasan, pemutus, dan tanggal
berlaku ke `accounting_policies` dalam satu transaksi. Tiga kebijakan sisanya
(`uang_saku_treatment`, `profit_sharing_65_35`, `accounting_standard`) belum
punya layar; mereka tidak memetakan ke kolom mana pun, jadi butuh bentuk yang
berbeda.

**`/intercompany` belum dibuat.** Tabelnya ada, view eliminasinya jalan, tapi
layarnya belum. Itu satu-satunya sisa Fase 3.

## Fase 4 — Ekspor & produksi (2–3 minggu)

- Ekspor Excel (`exceljs`) dan PDF
- Import CSV di layar input
- `adapter-auto` → `adapter-node`, deploy ke VPS
- Backup harian + uji restore bulanan ke database kosong

## Masih menunggu klien

`ASSUMPTIONS.md` A-1 sampai A-6 belum terjawab. Yang terkunci karenanya:

- **Neraca** — butuh saldo awal (A-4). Bukan pilihan lingkup; datanya memang
  belum ada.
- **Kolom kode akun** — butuh A-7.
- **Ambang peringatan yang bermakna** — butuh basis pelaporan tiap entitas
  ditetapkan (A-1, A-5), kalau tidak angkanya tidak sebanding.
- **Grafik tren 12 bulan dan kolom YoY** — butuh data ILJ 9 bulan masuk dulu,
  lalu tiga bulan lagi. Kolom YoY sudah ada di layar P&L dan sengaja kosong.

Semua di atas sudah punya jalur naik kelas di schema. Tidak ada yang
memerlukan refactor saat jawabannya masuk.
