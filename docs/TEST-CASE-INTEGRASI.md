# Test Case: Integrasi Sistem Operasional → Portal Keuangan

Panduan uji manual lewat browser, langkah demi langkah. Ditulis supaya bisa
dijalankan oleh orang yang belum (atau sudah tidak) hafal kedua sistem ini.
Mencakup perubahan 4 Oktober 2026: pemetaan biaya di portal, pengeluaran yang
belum dipetakan masuk Beban Operasional Lain, dan pemilihan sumber gaji admin.

Uji otomatis (kode) sudah ada dan lulus — lihat [TESTING-INTEGRASI.md](TESTING-INTEGRASI.md).
Dokumen ini adalah uji dari sisi pengguna.

---

## 1. Pengingat singkat: cara kerja integrasi

Ada **dua aplikasi terpisah**, masing-masing dengan database sendiri:

| | Sistem Operasional | Portal Keuangan |
|---|---|---|
| Alamat | https://imr-operasional.vercel.app | https://imr-keu.vercel.app |
| Dipakai oleh | admin operasional ILJ | staf entitas, manajer keuangan, direksi |
| Isinya | kegiatan kapal, truk, gaji, pengeluaran harian | laporan laba-rugi bulanan per entitas |

Alurnya:

```
Sistem Operasional                        Portal Keuangan
──────────────────                        ───────────────
admin mengisi kegiatan,                   staf ILJ membuka Input Laporan,
truk, gaji, pengeluaran   ── ditarik ──▶  menekan "Tarik data operasional"
                          (bukan dikirim)        │
                                                 ▼
                                          angka masuk sebagai DRAFT
                                                 │
                                          staf koreksi ▶ Ajukan ▶ manajer Setujui ▶ Kunci
```

Yang penting diingat:

- **Data tidak masuk otomatis.** Angka baru pindah ke portal ketika staf menekan
  **Tarik data operasional**. Sebelum itu, portal tidak tahu ada data baru.
- **Tarik data hanya bisa saat periode masih draft.** Setelah diajukan, tombolnya hilang.
- **Tarik ulang menimpa angka** pos-pos yang ditarik, termasuk koreksi manual. Portal
  menanyakan konfirmasi dulu kalau sudah ada angka.

### Dari mana setiap pos berasal

| Pos di portal (kode) | Nama di layar Input Laporan | Diambil dari sistem operasional |
|---|---|---|
| `REV_TAGIHAN` | Tagihan Jasa Angkutan | Laporan → Pendapatan Bulanan, kolom total |
| `COGS_PAJAK` | Pajak atas Tagihan | Laporan → Pendapatan Bulanan, kolom pajak |
| `COGS_REKANAN` | Bagian Rekanan | tonase × ongkos angkut per truk (uang ke pemilik truk) |
| `COGS_SAKU` | Uang Saku Operasional | saku per truk |
| `COGS_TERPAL` | Terpal | terpal per truk |
| `COGS_OPS` | Operasional Armada | biaya operasional kegiatan kapal |
| `COGS_TELLY` | Upah Telly | honor telly per kegiatan kapal |
| `COGS_PAGUYUBAN` | Iuran Paguyuban | iuran paguyuban (lihat bagian 6 — tidak bisa dibuat lewat layar) |
| `OPEX_*` | Gaji Karyawan, Sewa Kantor, Beban Kantor & ATK, dst. | **Pengeluaran** dan **gaji admin**, lewat **Pemetaan Biaya** di portal |
| `OPEX_LAIN` | Beban Operasional Lain | pengeluaran yang **belum dipetakan** |

### Pemetaan Biaya (baru, 4 Oktober 2026)

Pengeluaran di sistem operasional punya **jenis** yang diketik bebas oleh admin
(misalnya "Sewa Kantor", "Beli ATK"). Portal perlu tahu jenis mana masuk pos
mana. Itu diatur direksi di **Administrasi → Pemetaan Biaya**. Setiap jenis
bisa diberi salah satu pilihan:

| Pilihan | Akibat saat tarik data |
|---|---|
| **Belum dipetakan → Beban Operasional Lain** | masuk `OPEX_LAIN`, dan jenisnya disebut di peringatan kuning |
| **Tidak ditarik** | tidak masuk pos mana pun, dan disebut di catatan abu-abu |
| salah satu pos (Gaji Karyawan, Sewa Kantor, …) | dijumlahkan ke pos itu |

**Gaji admin** muncul di daftar itu sebagai jenis **"Gaji Admin Bulanan"** dengan
sumber **Honor Telly**. Kalau admin operasional mencatat gaji admin di halaman
Gaji Karyawan **dan juga** sebagai pengeluaran berjenis gaji, direksi harus
memetakan **salah satu** ke Gaji Karyawan dan yang lain **Tidak ditarik**.
Kalau keduanya dipetakan, gajinya terhitung dua kali (diuji di D5).

---

## 2. Persiapan

### Akun yang dibutuhkan

| Aplikasi | Peran | Dipakai untuk |
|---|---|---|
| Sistem Operasional | admin | mengisi data uji |
| Portal Keuangan | **direksi** | Pemetaan Biaya |
| Portal Keuangan | **staf entitas ILJ** | Input Laporan, tarik data, ajukan |
| Portal Keuangan | **manajer keuangan** *(opsional)* | A2 dan E3. Per 6 Oktober 2026 akun ini **belum ada**; E3 bisa dikerjakan direksi, karena direksi juga berhak menolak. |

Cara termudah: buka tiap akun portal di jendela browser terpisah (misalnya satu
jendela biasa, satu jendela Incognito/InPrivate, dan satu browser lain).

### Kredensial

Password **tidak ditulis di dokumen ini**, karena dokumen ini ikut ke git dan
GitHub. Catat email dan password di
[`docs/KREDENSIAL.local.md`](KREDENSIAL.local.md). File itu ada di laptop saja
dan diabaikan git (`*.local.md`).

| Platform | Alamat login | Peran yang dibutuhkan |
|---|---|---|
| Sistem Operasional | https://imr-operasional.vercel.app/login | admin |
| Portal Keuangan | https://imr-keu.vercel.app/login | direksi, staf entitas ILJ (manajer keuangan opsional) |

Email akun yang ada di production tercatat di `KREDENSIAL.local.md`, diambil
dari database pada 6 Oktober 2026.

Kalau lupa password:

| Yang lupa | Cara memulihkan |
|---|---|
| Akun portal selain direksi | Login sebagai direksi → **Administrasi → Pengguna**, lalu reset password akun itu. Di halaman yang sama bisa juga membuat akun staf ILJ / manajer baru khusus uji. |
| Akun direksi portal | Lewat Neon Console (project dengan endpoint `ep-late-dawn`) → Auth → Users. Butuh login Neon. |
| Akun lain di sistem operasional | Login sebagai admin → **Manajemen Pengguna**, lalu edit user dan isi password baru. |
| Akun admin sistem operasional | Tautan "lupa password" di halaman login (hanya berfungsi kalau email aplikasi sudah dikonfigurasi). Kalau tidak, minta direset lewat database. |

Akun di `README.md` (`direksi@example.test` dan seterusnya) hanya ada di
database **lokal** (`supabase start`), bukan di production.

### Aturan data uji

- **Periode uji: Desember 2026.** Bulan ini belum dipakai untuk data nyata. Semua
  tanggal di bawah ada di Desember 2026.
- **Semua nama diawali `UJI-INTEGRASI`**, supaya mudah dikenali dan dihapus.
- **Jangan menyetujui (Setujui/Kunci) periode Desember 2026.** Periode yang
  disetujui masuk angka konsolidasi direksi. Di E3 laporan hanya diajukan lalu
  dikembalikan ke draft.
- Sebelum mulai, buka **Administrasi → Pemetaan Biaya** sebagai direksi dan
  **catat pilihan untuk "Gaji Admin Bulanan"** kalau sudah ada. Setelah uji
  selesai, pilihan itu dikembalikan (F3).

### Cara mencatat hasil

Isi kolom **Hasil** di lembar hasil (bagian 8) dengan **Lulus**, **Gagal**, atau
**Dilewati**. Kalau gagal, tulis apa yang terlihat di layar, dan ambil
tangkapan layar.

---

## 3. Data uji (dummy)

### 3a. Diisi di Sistem Operasional

| # | Menu | Data |
|---|---|---|
| 1 | Master Data → Pemilik Kendaraan | `UJI-INTEGRASI Pemilik` |
| 2 | Master Data → Kendaraan | nopol `UJI 1234 IT`, pemilik `UJI-INTEGRASI Pemilik` |
| 3 | Master Data → Karyawan | `UJI-INTEGRASI Telly`, jabatan `Telly` |
| 4 | Master Data → Karyawan | `UJI-INTEGRASI Admin`, jabatan `Admin` |
| 5 | Database General | kapal `UJI-INTEGRASI KM Satu`, bulan pengiriman Desember, kegiatan 10–12 Des 2026 |
| 6 | Detail Kegiatan Kapal → Edit Data | rute `UJI Gudang` → `UJI Pelabuhan`, biaya operasional **300.000**, petugas telly `UJI-INTEGRASI Telly`, truk `UJI 1234 IT` |
| 7 | Detail Kegiatan Kapal → Lengkapi Data Kendaraan | trip **2**, tonase **10** MT, ongkos angkut **20.000**, saku **150.000**, terpal **50.000** |
| 8 | Gaji Karyawan (pilih `UJI-INTEGRASI Admin`) | gaji kotor **5.000.000**, PPh **0** |
| 9 | Pengeluaran | 15 Des 2026, jenis `UJI-INTEGRASI Sewa`, **1.500.000** |
| 10 | Pengeluaran | 15 Des 2026, jenis `UJI-INTEGRASI ATK`, **80.000** |
| 11 | Pengeluaran | 15 Des 2026, jenis `UJI-INTEGRASI ATK Lain`, **20.000** |
| 12 | Pengeluaran | 15 Des 2026, jenis `UJI-INTEGRASI Gaji`, **4.000.000** |

Gaji admin (5.000.000) dan pengeluaran gaji (4.000.000) **sengaja dibuat
berbeda**, supaya di layar portal kelihatan sumber mana yang sedang dipakai.

### 3b. Angka yang diharapkan di portal

Bagian operasional (tidak bergantung pada pemetaan):

| Pos | Nama di layar | Perhitungan | Harapan |
|---|---|---|---:|
| `REV_TAGIHAN` | Tagihan Jasa Angkutan | 10 MT × harga default 34.500 per ton | 345.000 |
| `COGS_PAJAK` | Pajak atas Tagihan | 0,5% × 345.000 | 1.725 |
| `COGS_REKANAN` | Bagian Rekanan | 10 × 20.000 | 200.000 |
| `COGS_SAKU` | Uang Saku Operasional | saku truk | 150.000 |
| `COGS_TERPAL` | Terpal | terpal truk | 50.000 |
| `COGS_OPS` | Operasional Armada | biaya operasional kegiatan | 300.000 |
| `COGS_TELLY` | Upah Telly | 10 MT × tarif default Rp 400 | 4.000 \* |
| `COGS_PAGUYUBAN` | Iuran Paguyuban | tidak bisa dibuat lewat layar | 0 |

\* Patokan yang pasti adalah angka **NET GAJI BERSIH** `UJI-INTEGRASI Telly` di
halaman Gaji Karyawan (langkah B4). Kalau di sana bukan 4.000, pakai angka itu.

Bagian pengeluaran, per tahap pemetaan:

| Pos | C3: belum ada pemetaan | D3: pemetaan awal | D4: sumber gaji ditukar | D5: dua sumber gaji |
|---|---:|---:|---:|---:|
| Sewa Kantor (`OPEX_SEWA`) | 0 / kosong | 1.500.000 | 1.500.000 | 1.500.000 |
| Beban Kantor & ATK (`OPEX_ATK`) | 0 / kosong | 100.000 | 100.000 | 100.000 |
| Gaji Karyawan (`OPEX_GAJI`) | 0 / kosong | 4.000.000 | 5.000.000 | 9.000.000 |
| Beban Operasional Lain (`OPEX_LAIN`) | **10.600.000** | 0 | 0 | 0 |

10.600.000 = 1.500.000 + 80.000 + 20.000 + 4.000.000 + 5.000.000.

---

## 4. Langkah uji

Format tiap kasus: **Tujuan**, **Siapa**, **Langkah**, **Hasil yang diharapkan**.

### Bagian A — Persiapan dan keadaan awal

#### A1. Direksi bisa membuka Pemetaan Biaya
- **Siapa:** direksi (portal)
- **Langkah:**
  1. Login ke portal.
  2. Klik menu **Administrasi** di sidebar.
  3. Klik tab **Pemetaan Biaya**.
- **Hasil yang diharapkan:**
  - Halaman terbuka tanpa error.
  - Ada paragraf penjelasan tentang "Belum dipetakan" dan "Tidak ditarik".
  - Tabel menampilkan daftar jenis biaya, atau tulisan "Belum ada jenis biaya" kalau sistem operasional belum punya pengeluaran.
  - **Tidak ada** kotak kuning "Daftar jenis dari sistem operasional tidak dapat diambil". Kalau kotak itu muncul, integrasi (alamat atau token) bermasalah. Catat pesannya.

#### A2. Selain direksi tidak bisa membuka Pemetaan Biaya
- **Siapa:** staf ILJ, lalu manajer keuangan
- **Langkah:**
  1. Login sebagai staf ILJ.
  2. Ketik langsung alamat `https://imr-keu.vercel.app/admin/pemetaan-biaya` di address bar.
  3. Ulangi dengan akun manajer keuangan, kalau akunnya ada.
- **Hasil yang diharapkan:**
  - Akun-akun itu dialihkan ke Dasbor dan tidak melihat halaman pemetaan.
  - Menu **Administrasi** tidak tampil di sidebar mereka.

#### A3. Keadaan awal periode uji: semua nol
- **Siapa:** staf ILJ
- **Langkah:**
  1. Klik **Input Laporan**.
  2. Kalau Desember 2026 belum ada di daftar: pilih bulan **Desember 2026**, lalu klik **Buat Periode Baru**. Kalau sudah ada (status Draft), klik untuk membukanya.
  3. Klik **Tarik data operasional**. Kalau muncul konfirmasi "Sebagian baris sudah terisi…", klik OK.
- **Hasil yang diharapkan:**
  - Muncul kotak hijau "… baris ditarik dari sistem operasional pukul …".
  - Semua pos pada tabel 3b bernilai **0**, termasuk Beban Operasional Lain.
  - Kalau ada yang tidak nol, Desember 2026 sudah berisi data lain. Hentikan uji dan bersihkan dulu.

### Bagian B — Mengisi data uji di Sistem Operasional

Semua langkah B dilakukan sebagai **admin sistem operasional**. Sebelum
mengisi, pastikan filter bulan di halaman yang dibuka adalah **Desember 2026**.

#### B1. Data master
- **Langkah:**
  1. **Master Data → Pemilik Kendaraan**:
     1. Klik **Tambah Pemilik Kendaraan**.
     2. Isi nama `UJI-INTEGRASI Pemilik`.
     3. Klik **Simpan Pemilik Kendaraan**.
  2. **Master Data → Kendaraan**:
     1. Klik **Tambah Data Kendaraan**.
     2. Isi nopol `UJI 1234 IT` dan pilih pemilik `UJI-INTEGRASI Pemilik`.
     3. Klik **Simpan Kendaraan**.
  3. **Master Data → Karyawan**:
     1. Klik **Tambah Data Karyawan**.
     2. Isi Nama Lengkap `UJI-INTEGRASI Telly` dan Jabatan `Telly`.
     3. Klik **Simpan Karyawan**.
     4. Ulangi untuk Nama Lengkap `UJI-INTEGRASI Admin` dengan Jabatan `Admin`.
- **Hasil yang diharapkan:** setiap simpan menampilkan pesan berhasil, dan keempat data muncul di daftarnya masing-masing.

#### B2. Kegiatan kapal
- **Langkah:**
  1. Sidebar **Database General**. Atur filter ke Desember 2026, lalu klik **Terapkan**.
  2. Klik **Tambah Data General**, lalu isi:
     - Nama Kapal `UJI-INTEGRASI KM Satu`
     - Bulan Pengiriman **Desember**
     - Tanggal Kegiatan (Mulai) 10-12-2026
     - Sampai Tanggal (Selesai) 12-12-2026
  3. Klik **Simpan Data Kapal**.
  4. Sidebar **Laporan → Detail Kegiatan Kapal** (filter Desember 2026). Pada baris `UJI-INTEGRASI KM Satu`, klik **Edit Data**, lalu isi:
     - rute asal `UJI Gudang`, rute tujuan `UJI Pelabuhan`
     - biaya operasional **300.000**
     - **Petugas Telly / Lapangan**: `UJI-INTEGRASI Telly`
     - di **Cari / Tambah Nopol Truk Cepat**, ketik `UJI 1234` lalu pilih truk `UJI 1234 IT`
  5. Klik **Simpan Perubahan Kegiatan Kapal**.
- **Hasil yang diharapkan:** kegiatan tersimpan, dan baris kapal uji tampil di Detail Kegiatan Kapal Desember 2026.

#### B3. Rincian truk
- **Langkah:**
  1. Di **Laporan → Detail Kegiatan Kapal**, pada baris kapal uji, klik **Lengkapi Data Kendaraan**.
  2. Pada baris truk `UJI 1234 IT`, isi: trip **2**, tonase **10**, ongkos angkut **20.000**, saku **150.000**, terpal **50.000**.
  3. Klik **Simpan Rincian Pembayaran Truk Kapal Ini**.
  4. Buka **Laporan → Pendapatan Bulanan** (Desember 2026).
- **Hasil yang diharapkan:** di Pendapatan Bulanan muncul baris kapal uji dengan total **345.000** dan pajak **1.725**. Baris ini dibuat otomatis; tidak perlu diisi.

#### B4. Honor telly
- **Langkah:**
  1. Buka **Laporan → Gaji Karyawan** (filter Desember 2026).
  2. Di **Pilih Karyawan Telly**, pilih `UJI-INTEGRASI Telly`.
- **Hasil yang diharapkan:**
  - Judul berubah menjadi "Rincian Honor Telly Karyawan".
  - Ada baris kegiatan kapal uji dengan tonase **10** dan gaji **400**.
  - **NET GAJI BERSIH = 4.000.**
  - Catat angka NET GAJI BERSIH. Angka ini menjadi harapan untuk Upah Telly di C2.

#### B5. Gaji admin
- **Langkah:**
  1. Masih di **Laporan → Gaji Karyawan**, pastikan filter **Desember 2026**.
  2. Di **Pilih Karyawan Telly**, pilih `UJI-INTEGRASI Admin`.
  3. Judul berubah menjadi "Rincian Gaji Admin". Pada baris kosong, isi **Total Gaji (Kotor)** `5.000.000` dan **Pot. PPh (Rp)** `0`.
  4. Klik **✓ Simpan Gaji**.
- **Hasil yang diharapkan:** muncul pesan "Gaji berhasil diperbarui.", dan Gaji Bersih = **5.000.000**.
- **Penting:** filter bulan **harus** Desember 2026 saat menyimpan pertama kali. Bulan simpan pertama inilah yang menentukan bulan gaji admin (lihat temuan di bagian 6).

#### B6. Pengeluaran
- **Langkah:** ulangi untuk keempat pengeluaran di tabel 3a (#9–#12):
  1. Sidebar **Laporan → Pengeluaran**, lalu klik **+ Tambah Pengeluaran**.
  2. Isi **Tanggal** 15-12-2026.
  3. Di **Jenis Pengeluaran**, pilih **+ Tambah jenis pengeluaran baru**, lalu ketik nama jenisnya (misalnya `UJI-INTEGRASI Sewa`).
  4. Isi **Jumlah (Rp)** sesuai tabel.
  5. Klik **Simpan Pengeluaran**.
- **Hasil yang diharapkan:** keempat pengeluaran tampil di Laporan Pengeluaran Desember 2026, dengan total **5.600.000**.

### Bagian C — Tarik data, sebelum ada pemetaan

#### C1. Data tidak masuk sendiri
- **Siapa:** staf ILJ
- **Langkah:** buka lagi Input Laporan Desember 2026 (muat ulang halaman). **Jangan** tekan Tarik data.
- **Hasil yang diharapkan:** semua pos masih **0**. Portal baru tahu ada data setelah tombol ditekan.

#### C2. Tarik data: angka operasional
- **Siapa:** staf ILJ
- **Langkah:** klik **Tarik data operasional**.
- **Hasil yang diharapkan:**
  - Kotak hijau "9 baris ditarik dari sistem operasional pukul …".
  - Di bawahnya: "Dihitung dari 1 invoice · 1 transaksi · 1 rekap bulanan · 4 pengeluaran · 1 baris gaji telly · 1 baris gaji admin". Urutannya boleh berbeda.
  - Kedelapan pos operasional sesuai tabel 3b: 345.000 / 1.725 / 200.000 / 150.000 / 50.000 / 300.000 / Upah Telly (angka dari B4) / Iuran Paguyuban 0.

#### C3. Pengeluaran tanpa pemetaan masuk Beban Operasional Lain
- **Siapa:** staf ILJ, di layar yang sama dengan C2
- **Hasil yang diharapkan:**
  - **Beban Operasional Lain = 10.600.000**.
  - Sewa Kantor, Beban Kantor & ATK, dan Gaji Karyawan tetap 0.
  - Ada kotak **kuning**: "Masuk Beban Operasional Lain karena belum dipetakan:", diikuti kelima jenis beserta nominalnya: UJI-INTEGRASI ATK (Rp 80.000), UJI-INTEGRASI ATK Lain (Rp 20.000), UJI-INTEGRASI Gaji (Rp 4.000.000), UJI-INTEGRASI Sewa (Rp 1.500.000), Gaji Admin Bulanan (Rp 5.000.000).
  - Tarik data **tidak** ditolak. Sebelum 4 Oktober, kasus ini ditolak.

### Bagian D — Pemetaan Biaya

#### D1. Jenis biaya muncul di Pemetaan Biaya
- **Siapa:** direksi
- **Langkah:** buka **Administrasi → Pemetaan Biaya**, atau muat ulang kalau sudah terbuka.
- **Hasil yang diharapkan:**
  - Kelima jenis dari C3 ada di tabel.
  - Jenis yang belum dipetakan tampil paling atas, dengan kotak pilihan bergaris kuning dan label "5 belum dipetakan" di kepala tabel. Angka bisa lebih besar kalau ada jenis nyata lain.
  - Kolom Sumber: empat jenis UJI tertulis **Pengeluaran**, sedangkan "Gaji Admin Bulanan" tertulis **Honor Telly**.
  - Kolom Terakhir: 2026-12-15 untuk pengeluaran. Untuk Gaji Admin Bulanan, tanggal terbaru dari semua gaji admin.

#### D2. Menyimpan pemetaan
- **Siapa:** direksi
- **Langkah:**
  1. Atur pilihan:
     - `UJI-INTEGRASI Sewa` → **Sewa Kantor**
     - `UJI-INTEGRASI ATK` → **Beban Kantor & ATK**
     - `UJI-INTEGRASI ATK Lain` → **Beban Kantor & ATK**
     - `UJI-INTEGRASI Gaji` → **Gaji Karyawan**
     - `Gaji Admin Bulanan` → **Tidak ditarik**
  2. Klik **Simpan pemetaan**.
- **Hasil yang diharapkan:**
  - Muncul kotak hijau "5 pemetaan disimpan. Berlaku untuk tarik data berikutnya…".
  - Setelah muat ulang, pilihan tetap seperti yang disimpan.
  - Label "belum dipetakan" berkurang 5.

#### D3. Tarik ulang dengan pemetaan
- **Siapa:** staf ILJ
- **Langkah:**
  1. Muat ulang Input Laporan Desember 2026.
  2. Klik **Tarik data operasional**, lalu setujui konfirmasi timpa.
- **Hasil yang diharapkan:**
  - Sewa Kantor **1.500.000**, Beban Kantor & ATK **100.000** (dua jenis dijumlahkan), Gaji Karyawan **4.000.000**, Beban Operasional Lain **0**.
  - **Tidak ada** kotak kuning.
  - Ada catatan abu-abu: "Tidak ditarik sesuai pemetaan: Gaji Admin Bulanan (Rp 5.000.000). Kalau biaya ini memang belum tercatat di pos lain, isi secara manual."
  - Pos operasional tetap seperti C2.

#### D4. Menukar sumber gaji admin
- **Tujuan:** memastikan direksi bisa memilih gaji dari Honor Telly, bukan dari pengeluaran.
- **Langkah:**
  1. Sebagai direksi: `UJI-INTEGRASI Gaji` → **Tidak ditarik**, dan `Gaji Admin Bulanan` → **Gaji Karyawan**. Klik **Simpan pemetaan**.
  2. Sebagai staf ILJ: tarik data lagi.
- **Hasil yang diharapkan:**
  - Pemetaan: "2 pemetaan disimpan."
  - Gaji Karyawan **5.000.000**.
  - Catatan abu-abu menyebut "UJI-INTEGRASI Gaji (Rp 4.000.000)".

#### D5. Dua sumber gaji dipetakan bersamaan (hitung ganda yang disengaja)
- **Tujuan:** menunjukkan kenapa direksi harus memilih satu sumber. Sistem **tidak** mencegah ini; ini keputusan direksi.
- **Langkah:**
  1. Sebagai direksi: `UJI-INTEGRASI Gaji` → **Gaji Karyawan**, sementara `Gaji Admin Bulanan` tetap **Gaji Karyawan**. Simpan.
  2. Sebagai staf ILJ: tarik data.
- **Hasil yang diharapkan:** Gaji Karyawan **9.000.000** (4.000.000 + 5.000.000), tanpa catatan abu-abu.

#### D6. Mengembalikan ke "Belum dipetakan"
- **Langkah:**
  1. Sebagai direksi: `UJI-INTEGRASI ATK Lain` → **Belum dipetakan → Beban Operasional Lain**. Simpan.
  2. Sebagai staf ILJ: tarik data.
- **Hasil yang diharapkan:**
  - Pemetaan: "1 pemetaan disimpan."
  - Beban Kantor & ATK **80.000**, Beban Operasional Lain **20.000**.
  - Kotak kuning menyebut "UJI-INTEGRASI ATK Lain (Rp 20.000)".

### Bagian E — Perilaku tarik data

#### E1. Koreksi manual tertimpa saat tarik ulang, dengan konfirmasi
- **Siapa:** staf ILJ
- **Langkah:**
  1. Ubah Sewa Kantor menjadi **1.000**, lalu klik **Simpan Draft**.
  2. Muat ulang. Pastikan Sewa Kantor tetap 1.000.
  3. Klik **Tarik data operasional**.
- **Hasil yang diharapkan:**
  - Muncul konfirmasi "Sebagian baris sudah terisi. Tarik data akan mengganti angkanya…".
  - Kalau dibatalkan, tidak ada yang berubah.
  - Kalau disetujui, Sewa Kantor kembali **1.500.000**.

#### E2. Perubahan di sistem operasional baru masuk setelah tarik ulang
- **Langkah:**
  1. Sebagai admin operasional: di **Laporan → Pengeluaran**, edit `UJI-INTEGRASI Sewa` (ikon pensil) menjadi **1.750.000**, lalu klik **Simpan Perubahan**.
  2. Sebagai staf ILJ: muat ulang Input Laporan **tanpa** tarik. Lalu klik tarik data.
- **Hasil yang diharapkan:** sebelum tarik, Sewa Kantor masih 1.500.000. Sesudah tarik, menjadi **1.750.000**.

#### E3. Periode yang sudah diajukan tidak bisa ditarik
- **Langkah:**
  1. Sebagai staf ILJ: klik **Ajukan** pada Desember 2026.
  2. Buka lagi periode itu.
- **Hasil yang diharapkan:**
  - Status menjadi Diajukan.
  - Tombol **Tarik data operasional** tidak tampil.
  - Angka tidak bisa diubah.
- **Langkah lanjutan (wajib):**
  1. Sebagai manajer keuangan, atau direksi kalau akun manajer belum ada: buka **Persetujuan**, pilih ILJ Desember 2026.
  2. Klik **Tolak…**, isi catatan `UJI-INTEGRASI selesai`, lalu klik **Tolak & kembalikan ke draft**.
  3. **Jangan klik Setujui.**
- **Hasil yang diharapkan:** staf ILJ melihat periode kembali Draft dengan catatan "Dikembalikan ke draft: UJI-INTEGRASI selesai", dan tombol tarik data muncul lagi.

### Bagian F — Bersih-bersih (wajib, urutannya penting)

Urutan ini disengaja. Pos yang pemetaannya dihapus tidak lagi ikut ditarik, jadi
angka lamanya akan tertinggal di periode uji. Karena itu tarik data terakhir
dilakukan **sebelum** pemetaan dihapus.

#### F1. Hapus data uji di Sistem Operasional
- **Siapa:** admin operasional
- **Langkah:** hapus dengan ikon/tombol hapus di masing-masing halaman, lalu konfirmasi **Ya, Hapus**:
  1. keempat pengeluaran `UJI-INTEGRASI` (Laporan → Pengeluaran, Desember 2026)
  2. kegiatan `UJI-INTEGRASI KM Satu` (Database General, Desember 2026)
  3. kapal `UJI-INTEGRASI KM Satu` (Master Data → Kapal)
  4. kendaraan `UJI 1234 IT`
  5. pemilik `UJI-INTEGRASI Pemilik`
  6. karyawan `UJI-INTEGRASI Telly`. Honor telly-nya sudah ikut terhapus bersama kegiatan.
  7. karyawan `UJI-INTEGRASI Admin` **tidak bisa dihapus lewat layar**: karyawan yang masih punya baris gaji ditolak, dan tidak ada layar untuk menghapus baris gaji admin (lihat bagian 6). Ada dua jalan:
     - Hapus lewat database. Skrip `tests/e2e/test-case-integrasi.mjs` melakukannya otomatis.
     - Kalau tidak bisa, ubah Total Gaji (Kotor)-nya menjadi 0 di Gaji Karyawan Desember 2026 supaya tidak terhitung, lalu biarkan karyawannya.
- Terakhir, buka **Laporan → Pendapatan Bulanan** Desember 2026 sekali. Membuka halaman ini membuang baris pendapatan kapal yang sudah dihapus.
- **Hasil yang diharapkan:** tidak ada lagi data berawalan `UJI` di halaman-halaman itu.

#### F2. Tarik data terakhir
- **Siapa:** staf ILJ
- **Langkah:** tarik data Desember 2026.
- **Hasil yang diharapkan:**
  - **Semua** pos bernilai 0: kedelapan pos operasional, Sewa Kantor, Beban Kantor & ATK, Gaji Karyawan, dan Beban Operasional Lain.
  - Tidak ada kotak kuning maupun catatan abu-abu.

#### F3. Hapus pemetaan uji
- **Siapa:** direksi
- **Langkah:**
  1. Di **Pemetaan Biaya**, ubah keempat jenis `UJI-INTEGRASI` menjadi **Belum dipetakan**.
  2. Kembalikan **Gaji Admin Bulanan** ke pilihan yang dicatat saat persiapan.
  3. Klik **Simpan pemetaan**, lalu muat ulang.
- **Hasil yang diharapkan:** keempat jenis `UJI-INTEGRASI` hilang dari tabel. Jenis yang tidak lagi tercatat dan tidak punya pemetaan memang tidak ditampilkan.

Setelah F3, periode ILJ Desember 2026 tetap ada sebagai draft bernilai nol.
Portal tidak punya tombol hapus periode, dan periode draft nol tidak
memengaruhi laporan mana pun.

---

## 5. Yang sudah diuji otomatis (tidak perlu diuji manual)

| Hal | Di mana |
|---|---|
| Nominal tidak bergeser satu sen pun (tidak lewat float) | IMR_keu `tests/operational-mapping.test.ts` |
| Iuran paguyuban dihitung dari bulan transaksi | LaporanKeuangan `tests/Feature/IntegrasiRekapBulananTest.php` |
| Gaji admin bulan lain tidak ikut | idem |
| Staf tidak bisa mengubah pemetaan, perubahannya tercatat di audit | IMR_keu `tests/operational-sync.test.ts` |
| Portal menolak respons dari sistem operasional versi lama | IMR_keu `tests/operational-mapping.test.ts` |

## 6. Batasan dan temuan yang perlu diketahui

Temuan ini ada di **sistem operasional**. Belum diperbaiki dan di luar cakupan
perubahan 4 Oktober.

1. **Iuran Paguyuban tidak bisa dibuat lewat layar.**
   - Kapal tidak bisa diberi paguyuban dari form Kapal.
   - Form tambah transaksi menyembunyikan tonase (selalu 0), padahal baris iuran hanya dibuat kalau tonase lebih dari 0.
   - Halaman paguyuban (`/laporan/paguyuban`) juga tidak ada di menu.
   - Akibatnya `COGS_PAGUYUBAN` selalu 0 kalau data diisi lewat layar. Perhitungannya sendiri sudah diuji otomatis dengan data dummy.
2. **Gaji admin tidak terikat bulan.** Halaman Gaji Karyawan untuk admin menampilkan dan mengubah **baris yang sama** di bulan mana pun. Baris gaji admin hanya tercatat di bulan **saat pertama kali disimpan**, sehingga bulan-bulan berikutnya tidak punya gaji admin di tarik data.
   - Sampai ini diperbaiki, sebaiknya gaji karyawan diambil dari **pengeluaran berjenis gaji** (dicatat tiap bulan), dan "Gaji Admin Bulanan" diset **Tidak ditarik**.
3. **Honor telly per truk** (bukan per kegiatan kapal) tidak bisa dibuat lewat layar, karena form truk tidak punya kolom telly. Honor telly yang berfungsi adalah lewat **Petugas Telly** di Edit Data kegiatan kapal, seperti di B2.
4. **Karyawan yang punya gaji admin tidak bisa dihapus**, dan baris gaji admin tidak punya tombol hapus. Saat penghapusan ditolak, sistem operasional juga membuka modal "Tambah Karyawan" yang menutupi pesan error-nya. *(Ditemukan saat end-to-end, 6 Oktober 2026.)*

Temuan di **portal keuangan**:

5. **Layar input hanya menerima rupiah bulat.** Hasil tarik data bisa bersen. Contohnya pajak Oktober 2026 tersimpan 1.897,50, tapi ditampilkan 1.898. Kalau staf menekan Simpan Draft atau Ajukan, angka itu tersimpan ulang sebagai **1.898** dan barisnya menjadi "manual". Selisihnya paling banyak Rp 0,50 per pos. *(Ditemukan saat end-to-end, 6 Oktober 2026; belum diperbaiki.)*

---

## 7. Uji otomatis lewat browser

`tests/e2e/test-case-integrasi.mjs` menjalankan A1–F3 dengan Playwright, lalu
menarik data Oktober 2026 (O1). Kredensial dibaca dari `docs/KREDENSIAL.local.md`
atau dari variabel environment. Tanpa password direksi, A1, D1–D6, E3, dan F3
dilewati.

```sh
npm i --no-save playwright && npx playwright install chromium
node tests/e2e/test-case-integrasi.mjs        # uji lengkap
HANYA_BERSIH=1 node tests/e2e/test-case-integrasi.mjs   # hanya bersih-bersih
```

Tangkapan layar dan `hasil.json` ditulis ke `tests/e2e/hasil/test-case/`.

**Hasil 6 Oktober 2026 (tanpa akun direksi):** 16 lulus, 9 dilewati, dan B5
tercatat gagal karena salah cek di skrip. Tangkapan layar menunjukkan gaji admin
5.000.000 tersimpan, dan C3 membuktikan angka itu ikut ditarik; pengecekannya
sudah diperbaiki. Data uji sudah dibersihkan, dan Desember 2026 kembali nol.

## 8. Lembar hasil

Tanggal uji: ____________  Penguji: ____________

| ID | Kasus | Hasil | Catatan |
|---|---|---|---|
| A1 | Direksi membuka Pemetaan Biaya | | |
| A2 | Selain direksi tidak bisa | | |
| A3 | Keadaan awal semua nol | | |
| B1 | Data master | | |
| B2 | Kegiatan kapal | | |
| B3 | Rincian truk, pendapatan otomatis | | |
| B4 | Honor telly (NET GAJI BERSIH = ______) | | |
| B5 | Gaji admin | | |
| B6 | Pengeluaran | | |
| C1 | Data tidak masuk sendiri | | |
| C2 | Tarik data: angka operasional | | |
| C3 | Belum dipetakan → Beban Operasional Lain | | |
| D1 | Jenis muncul di Pemetaan Biaya | | |
| D2 | Menyimpan pemetaan | | |
| D3 | Tarik ulang dengan pemetaan | | |
| D4 | Menukar sumber gaji admin | | |
| D5 | Dua sumber gaji (hitung ganda) | | |
| D6 | Kembali ke Belum dipetakan | | |
| E1 | Koreksi manual tertimpa, dengan konfirmasi | | |
| E2 | Perubahan baru masuk setelah tarik ulang | | |
| E3 | Periode diajukan tidak bisa ditarik; dikembalikan ke draft | | |
| F1 | Hapus data uji operasional | | |
| F2 | Tarik akhir semua nol | | |
| F3 | Hapus pemetaan uji | | |
