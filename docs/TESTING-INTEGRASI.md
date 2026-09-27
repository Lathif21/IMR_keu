# Tes Integrasi: Sistem Operasional → Portal Keuangan

Menguji jalur data dari **imr-operasional** (LaporanKeuangan, Laravel) ke
**imr-keu** (portal keuangan, SvelteKit) lewat layar, bukan lewat API:
semua langkah dijalankan di browser dengan Playwright, persis seperti yang
dilakukan admin operasional dan staf entitas.

| | |
|---|---|
| Sistem operasional | https://imr-operasional.vercel.app |
| Portal keuangan | https://imr-keu.vercel.app |
| Entitas | ILJ |
| Periode uji | **Desember 2026** (`2026-12`) — bulan yang belum dipakai untuk data nyata |
| Penanda data uji | setiap nama diawali `UJI-INTEGRASI` / `UJI`, supaya mudah dikenali dan dihapus |
| Skrip | [`tests/e2e/integrasi-operasional.mjs`](../tests/e2e/integrasi-operasional.mjs) |

## Pertanyaan yang dijawab

**Apakah data langsung masuk ke portal keuangan begitu input di sistem
operasional selesai?**

**Tidak, dan itu disengaja.** Portal keuangan yang *menarik* data, bukan
sistem operasional yang mendorong ([task/10-integrasi-operasional.md](task/10-integrasi-operasional.md)).
Angka baru masuk ketika staf entitas menekan **Tarik data operasional** di
layar Input Laporan. Sampai tombol itu ditekan, portal tidak tahu ada data
baru — T3 dan T5 membuktikannya di layar. Angka yang ditarik masuk sebagai
`draft` dan masih bisa dikoreksi sebelum diajukan.

## Alur input yang diuji

Tidak ada form "tambah pendapatan" di sistem operasional: baris Laporan
Pendapatan dibuat otomatis dari kegiatan kapal. Jadi tes mengikuti alur
admin operasional yang sebenarnya:

| # | Layar di sistem operasional | Yang diisi |
|---|---|---|
| 1 | Pemilik Kendaraan, Kendaraan | pemilik `UJI-INTEGRASI Pemilik`, nopol `UJI 1234 IT` |
| 2 | Database General → **Tambah Data General** | kapal `UJI-INTEGRASI KM Satu`, 10–12 Des 2026 |
| 3 | Detail Kegiatan Kapal → **Edit Data** | rute `UJI Gudang → UJI Pelabuhan`, biaya operasional **300.000**, truk `UJI 1234 IT` |
| 4 | Detail Kegiatan Kapal → **Lengkapi Data Kendaraan** | trip 2, tonase **10 MT**, ongkos angkut **20.000**, saku **150.000**, terpal **50.000** |
| 5 | Laporan Pendapatan | *(tidak diisi — baris dibuat otomatis dari tonase)* |

## Angka yang diharapkan di portal

| Pos | Nama di layar | Asal | Harapan |
|---|---|---|---:|
| `REV_TAGIHAN` | Tagihan Jasa Angkutan | 10 MT × 1.000 kg × harga default 34.500 / 1.000 | 345.000 |
| `COGS_PAJAK` | Pajak atas Tagihan | 0,5% (tarif default) × 345.000 | 1.725 |
| `COGS_REKANAN` | Bagian Rekanan | tonase 10 × ongkos angkut 20.000 | 200.000 |
| `COGS_SAKU` | Uang Saku Operasional | saku truk | 150.000 |
| `COGS_TERPAL` | Terpal | terpal truk | 50.000 |
| `COGS_OPS` | Operasional Armada | biaya operasional kegiatan | 300.000 |

Yang tidak diuji: `COGS_TELLY` dan `COGS_PAGUYUBAN` (butuh telly dan data
paguyuban), dan pengeluaran yang **sudah** dipetakan — pemetaan jenis →
`OPEX_*` (`pengeluaran_line_mapping`) belum punya layar, jadi jalur positifnya
tidak bisa dicapai lewat UI. Pengeluaran diuji hanya di jalur penolakan (T6).

## Skenario

| ID | Langkah | Hasil yang diharapkan |
|---|---|---|
| T1 | Portal: buka Input Laporan ILJ Desember 2026 (buat periodenya bila belum ada), tarik data. | Tarik berhasil. Keenam pos = 0 karena sistem operasional belum punya data Desember 2026. |
| T2 | Operasional: jalankan alur input di atas, lalu buka Laporan Pendapatan Desember 2026. | Baris pendapatan kapal uji muncul otomatis: total 345.000, pajak 1.725. |
| T3 | Portal: muat ulang Input Laporan **tanpa** menekan Tarik data. | Keenam pos tetap 0 — data tidak masuk otomatis. |
| T4 | Portal: tekan **Tarik data operasional**. | Keenam pos sama dengan tabel harapan. |
| T5 | Operasional: ubah saku truk menjadi 175.000. Portal: muat ulang, lalu tarik lagi (setujui konfirmasi timpa). | Sebelum tarik: `COGS_SAKU` masih 150.000. Sesudah tarik: 175.000. |
| T6 | Operasional: tambah pengeluaran dengan jenis baru `UJI-INTEGRASI jenis belum dipetakan`. Portal: tarik data. | Ditolak dengan pesan yang menyebut jenis itu. Angka tidak berubah (`COGS_SAKU` tetap 175.000). |
| T7 | Bersih-bersih: hapus pengeluaran, kegiatan, kapal, kendaraan, dan pemilik uji. Portal: tarik data. | Tarik berhasil, keenam pos kembali 0. |

Setelah T7, periode ILJ Desember 2026 di portal tetap ada sebagai `draft`
dengan angka nol. Portal tidak punya layar hapus periode; periode draft nol
tidak memengaruhi laporan mana pun.

## Menjalankan ulang

```sh
npm i --no-save playwright
npx playwright install chromium
OPS_EMAIL=... OPS_PASSWORD=... KEU_EMAIL=... KEU_PASSWORD=... \
  node tests/e2e/integrasi-operasional.mjs
```

`KEU_EMAIL` harus akun `staf_entitas` yang ditautkan ke ILJ — hanya peran itu
yang boleh mengisi laporan. Skrip membersihkan sisa data uji dulu, menjalankan
T1–T7, dan menulis tangkapan layar tiap langkah ke `tests/e2e/hasil/`.
Bersih-bersih (T7) selalu dijalankan, juga ketika langkah sebelumnya gagal.

## Hasil — 27 September 2026

**7 dari 7 lulus**, setelah tiga bug di bawah diperbaiki.

| ID | Hasil | Yang terlihat di layar |
|---|---|---|
| T1 | Lulus | "8 baris ditarik dari sistem operasional … Dihitung dari 0 invoice · 0 transaksi · 0 rekap bulanan"; semua pos 0 |
| T2 | Lulus | Baris pendapatan otomatis: Rp 345.000, pajak 0,5% Rp 1.725, net Rp 343.275 |
| T3 | Lulus | Semua pos masih 0 sebelum tombol ditekan |
| T4 | Lulus | "Dihitung dari 1 invoice · 1 transaksi · 1 rekap bulanan"; 345.000 / 1.725 / 200.000 / 150.000 / 50.000 / 300.000 |
| T5 | Lulus | `COGS_SAKU` 150.000 sebelum tarik ulang, 175.000 sesudahnya |
| T6 | Lulus | "Ada jenis pengeluaran yang belum dipetakan ke pos laporan, jadi tidak ada baris yang ditulis: UJI-INTEGRASI jenis belum dipetakan." |
| T7 | Lulus | Semua data uji terhapus; tarik akhir mengembalikan semua pos ke 0 |

### Bug yang ditemukan dan diperbaiki

Ketiganya ada di sistem operasional, dan ketiganya sudah di-deploy.

1. **Tarik data selalu gagal: "Sistem operasional menjawab dengan status 404."**
   Di Vercel, launcher `vercel-php` mengisi `SCRIPT_NAME=/api/index.php`, dan
   Symfony membuang awalan `/api` dari setiap URL — `/api/integrasi/rekap-bulanan`
   sampai di Laravel sebagai `/integrasi/rekap-bulanan`. Integrasi tidak
   pernah bisa bekerja di production. Diperbaiki di `api/index.php`
   (LaporanKeuangan `e8e43e0`).
2. **Biaya operasional hilang setelah rincian truk disimpan.** Menyimpan
   Rincian Pembayaran Truk menghitung ulang rekap dari baris truk, termasuk
   `operasional = SUM(transaksi.operasional)` — selalu nol, karena biaya
   operasional hanya diisi di rekap. Angka yang diisi admin tertimpa, dan
   portal menarik `COGS_OPS` = 0. Diperbaiki di `LaporanController`, dengan
   test `tests/Feature/RincianTrukTest.php` (LaporanKeuangan `febd7ca`).
3. **Hapus kapal gagal dengan error 500** ("current transaction is aborted").
   Transaksi database lewat pooler Neon (PgBouncer) gagal di tengah jalan.
   `DB_HOST` production sistem operasional dipindah ke host Neon langsung
   (tanpa `-pooler`); perubahan env, bukan kode.
