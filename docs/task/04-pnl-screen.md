# Fase 2 · Tugas 4 — Layar Laporan P&L

Layar terakhir yang tersisa disabled di sidebar. Read-only, jadi paling
sederhana dari keempatnya — seluruh perhitungan sudah ada di `v_period_pnl`.

Kerjakan setelah Tugas 3, supaya diuji dengan 9 periode nyata dan bukan dua
periode seed.

Baca dulu: `CLAUDE.md` (invarian 2), `CONTEXT.md` ("Basis pelaporan").

## Rute

```
src/routes/(app)/entities/[id]/periods/[period]/+page.server.ts
src/routes/(app)/entities/[id]/periods/[period]/+page.svelte
src/routes/(app)/entities/+page.server.ts     daftar entitas + periodenya
src/routes/(app)/entities/+page.svelte
```

`[period]` berformat `YYYY-MM`.

Sidebar "Laporan P&L" mengarah ke `/entities`.

## Akses

Tidak ada pengecekan peran. RLS yang menentukan: `has_entity_access()` sudah
membatasi `staf_entitas` ke entitasnya sendiri, dan `v_period_pnl` memakai
`security_invoker = on` sehingga ikut terbatas.

Entitas yang tidak boleh diakses menghasilkan nol baris. Tampilkan 404, bukan
halaman kosong.

## Halaman daftar (`/entities`)

Kartu per entitas: nama, lini usaha, chip basis pelaporan, periode terakhir
yang disetujui, laba bersih periode itu.

Untuk `staf_entitas` hanya akan muncul satu kartu. Itu benar — jangan
tambahkan pesan khusus.

## Laporan

### Muat

1. `entities` untuk `[id]` — 404 bila kosong
2. `v_period_pnl` untuk `(entity_id, period)` — 404 bila kosong
3. `v_period_pnl` untuk `previousPeriod(period)` — boleh kosong
4. `v_period_comparison` untuk baris YoY
5. `report_lines` + `report_template_lines` untuk rincian per pos
6. Daftar periode entitas ini, untuk pemilih di header

### Header

Nama entitas · periode · badge status · chip basis pelaporan.

Chip amber bila `reporting_basis` atau `revenue_presentation` bernilai
`unknown`, dengan teks dari `REPORTING_BASIS_LABEL` /
`REVENUE_PRESENTATION_LABEL`. Pembaca harus tahu ia sedang melihat angka yang
basisnya belum disepakati.

Pemilih periode di kanan, memuat seluruh periode entitas ini.

### Tabel laporan

Bertingkat, urutan tetap:

```
Pendapatan
  <baris revenue>
Beban Pokok Pendapatan
  <baris cogs>
= Laba Kotor
Beban Usaha
  <baris opex>
= Laba Operasi
Pendapatan Lain-lain
Beban Lain-lain
Pajak Penghasilan
= Laba Bersih
```

Kolom: Pos · Periode ini · Periode lalu · Δ (MoM %) · Kontribusi terhadap
pendapatan (%).

Baris subtotal (`Laba Kotor`, `Laba Operasi`, `Laba Bersih`) **diambil dari
`v_period_pnl`**, tidak dihitung ulang di klien atau di server (invarian 2).
Baris rincian diambil dari `report_lines`.

Beri baris subtotal border atas `--color-border-strong` dan bobot tebal.

### Aturan angka

- `formatAmount()`. Negatif dalam kurung: `(2.178.807)`, bukan `-2.178.807`
- Rata kanan, `tabular-nums` (sudah otomatis lewat `app.css`)
- Δ positif hijau, negatif merah, **kecuali pada baris beban** — beban naik
  bukan kabar baik. Untuk section `cogs`, `opex`, `other_expense`, `tax`,
  balikkan warnanya
- Pembagi nol atau data tidak ada → `NO_DATA` (`—`), bukan `0%`
- Kontribusi di-clamp lewat `clampPct()` — margin bisa melebihi 100% atau
  negatif, dan bar yang rusak adalah bug prototipe yang jangan diulang
- Label perbandingan **MoM**, bukan YoY. YoY punya kolomnya sendiri dan akan
  kosong sampai data mencapai 12 bulan

### Catatan baris

`report_lines.note` ditampilkan sebagai teks kecil `--color-subtle` di bawah
nama pos. Baris hasil import ILJ membawa catatan tentang uang saku — itu
memang dimaksudkan untuk terlihat.

### Peringatan kebijakan terbuka

Bila ada `accounting_policies` dengan `chosen_value IS NULL` yang berlaku
untuk entitas ini atau seluruh grup, tampilkan banner amber di atas tabel:

```
Sebagian kebijakan akuntansi belum ditetapkan — angka bersifat sementara.
```

Sebutkan `policy_key`-nya. Dasbor sudah melakukan ini; ikuti polanya.

## Selesai bila

- [ ] `npm run check` bersih
- [ ] Sembilan periode ILJ bisa dibuka, semuanya menampilkan angka
- [ ] Juli 2025 menampilkan laba bersih `(2.178.807)` dalam kurung dan merah
- [ ] Subtotal identik dengan `v_period_pnl` — bandingkan langsung lewat SQL
- [ ] Kolom MoM terisi di 8 periode, kosong di periode pertama
- [ ] Kolom YoY kosong di seluruh periode, dan itu benar
- [ ] Kenaikan beban tampil merah, bukan hijau
- [ ] Staf ILJ tidak bisa membuka laporan entitas lain — 404, bukan halaman kosong
- [ ] Auditor bisa membuka seluruh entitas, tanpa tombol ubah apa pun
- [ ] Chip basis pelaporan amber, karena ILJ masih `unknown` (A-1, A-4)
- [ ] Catatan uang saku terlihat di baris `COGS_SAKU`
- [ ] Sidebar tidak lagi punya item disabled

## Ditunda

| Hal | Alasan |
|---|---|
| Ekspor Excel/PDF | Fase 4 |
| Grafik tren 12 bulan | Data belum sampai 12 bulan |
| Perbandingan antar-entitas berdampingan | Basis pelaporan masih `unknown`; menyandingkannya sekarang justru menyesatkan (`CONTEXT.md`) |
| Drill-down ke tingkat invoice | Sistem menyimpan agregat bulanan. Tidak ada yang bisa didalami |
