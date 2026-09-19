# Fase 3 · Tugas 10 — Integrasi Sistem Operasional

Menarik angka bulanan dari sistem operasional ILJ (Laravel, repo
`labibb41/LaporanKeuangan`) ke `report_lines` periode draft, supaya admin
operasional cukup menginput sekali.

Baca dulu: `CLAUDE.md` (invarian 2, 5, 7, 8), `CONTEXT.md` (kosakata),
`ASSUMPTIONS.md` (A-1, A-2, A-4).

> **Pemetaan sudah diperiksa terhadap kode Laravel yang sebenarnya**, bukan
> terhadap nama tabel saja. Empat hal yang tidak bisa disimpulkan dari kode
> diputuskan pada 20 September 2026 dan dicatat di "Keputusan 20 September
> 2026" di bawah; alasan teknis tiap keputusan ada di bagian yang bersangkutan.

## Bentuk integrasi

Dua sistem, dua database, tetap berdiri sendiri.

```
Laravel + MySQL                    IMR_keu + Supabase
─────────────────                  ──────────────────
admin input operasional
  transaksi_operasional
  operasional_rekap
  laporan_pendapatan     ──GET──▶  tombol "Tarik data operasional"
  pengeluaran             agregat  di /entry/[period]
  gaji_telly              bulanan       │
  paguyuban                             ▼
                                   report_lines (draft, source='operasional')
                                        │
                                        ▼
                                   staf koreksi ▶ ajukan ▶ setujui ▶ kunci
```

**IMR_keu yang menarik, bukan Laravel yang mendorong.** Tombolnya ada di layar
input, jadi arah panggilannya mengikuti tombol. Konsekuensinya: Laravel tidak
perlu tahu apa pun tentang Supabase, dan sistem operasional tetap jalan penuh
kalau portal keuangan mati.

**Angka yang ditarik masih bisa dikoreksi.** Sinkronisasi mengisi periode
`draft`; yang mengajukan tetap manusia. Sistem operasional adalah sumber
angka, bukan pemilik laporan.

## Invarian yang mengikat tugas ini

| Invarian | Akibatnya di sini |
|---|---|
| 2 · subtotal tidak pernah disimpan | Endpoint hanya mengirim baris input. `total_biaya`, `laba_kotor`, `laba_bersih` di model Laravel adalah subtotal — jangan dikirim, jangan disimpan. |
| 3 · `numeric(18,2)`, rupiah penuh | Nominal dikirim sebagai **string** di JSON, bukan `number`. `json_encode` PHP mengubah decimal jadi float, dan float membuat Rp200.445.000 jadi Rp200.444.999,99. |
| 4 · audit ditulis trigger | Sinkronisasi menulis lewat `report_lines` seperti form biasa. Tidak ada jalur khusus, jadi tidak ada yang lolos audit. |
| 5 · `report_lines` hanya bisa ditulis saat draft | Tarik data pada periode non-draft harus gagal dengan pesan jelas, bukan diam-diam tidak melakukan apa-apa. Trigger sudah menolak; UI tidak boleh menyembunyikan penolakannya. |
| 7 · template adalah data | `COGS_TELLY` dan `COGS_PAGUYUBAN` masuk lewat *insert* baris template versi baru, bukan konstanta TypeScript. |
| 8 · jangan mengarang kebijakan | Jenis pengeluaran yang belum dipetakan **menghentikan** sinkronisasi dan menampilkan daftarnya. Tidak ada fallback diam-diam ke `OPEX_LAIN`. |

## Pemetaan

Sumber di Laravel → `line_code` di IMR_keu. Semua agregat untuk satu bulan.

| Baris | Sumber | Rumus |
|---|---|---|
| `REV_TAGIHAN` | `laporan_pendapatan` | `sum(total)` — yang ditagihkan ke pelanggan |
| `COGS_PAJAK` | `laporan_pendapatan` | `sum(pajak)` |
| `COGS_REKANAN` | `transaksi_operasional` | `sum(pendapatan)` — lihat catatan di bawah |
| `COGS_SAKU` | `transaksi_operasional` / `operasional_rekap` | `sum(sangu_supir)` per rute — lihat "Dua jalur input, satu angka per rute" |
| `COGS_TERPAL` | `transaksi_operasional` / `operasional_rekap` | `sum(terpal)` per rute, aturan yang sama |
| `COGS_OPS` | `operasional_rekap` | `sum(operasional)` — lihat "Biaya operasional tidak ada di kolomnya" |
| `COGS_TELLY` *(baru)* | `gaji_telly` | `sum(gaji_bersih)` baris telly saja — lihat "Tiga jenis baris di `gaji_telly`" |
| `COGS_PAGUYUBAN` *(baru)* | `paguyuban` | `sum(total_bayar)`, bulan lewat `transaksi_operasional.tanggal` induknya |
| `OPEX_*` | `pengeluaran` | `sum(jumlah)` dikelompokkan lewat tabel pemetaan `jenis` → `line_code` |

Bulan sebuah transaksi ditentukan oleh **`transaksi_operasional.tanggal`** —
kolom yang sudah dipakai scope `periode()` di Laravel. Alasannya bukan
akuntansi melainkan keterlacakan: angka di portal keuangan harus cocok dengan
Laporan Operasional yang dilihat admin, atau selisihnya akan diperdebatkan
setiap bulan tanpa ada yang bisa membuktikan mana yang benar. Kegiatan yang
melintasi pergantian bulan karena itu masuk bulan `tanggal`-nya, bukan bulan
selesainya. Kalau A-4 nanti diputuskan akrual, ini yang pertama ditinjau
ulang.

`laporan_pendapatan` tidak terpengaruh — tabel itu punya kolom `bulan` dan
`tahun` sendiri.

Cocok dengan struktur workbook historis ILJ di
[`03-import-ilj.md`](03-import-ilj.md): kolom TAGIHAN, PAJAK, REKANAN, SAKU,
TERPAL, OPERASIONAL ada satu-lawan-satu. Impor historis dan sinkronisasi
berjalan menghasilkan bentuk baris yang sama.

### Biaya operasional tidak ada di kolomnya

`COGS_OPS` tidak bisa diambil dari `transaksi_operasional.operasional`. Kolom
itu **selalu ditulis `0`** di seluruh jalur simpan
(`TransaksiOperasionalController` baris 255, 399, dan 591), dan migrasi
`2026_04_06_000900` memindahkan isi lamanya ke `pendapatan` lalu menge-nol-kan
kolomnya. Jumlahnya karena itu nol untuk setiap bulan, bukan kadang-kadang.

Nol yang salah lebih berbahaya daripada baris yang hilang: aturan di bawah
menyatakan nol berarti "sudah dihitung, hasilnya nol", jadi laporan akan
menampilkan biaya operasional nihil tanpa ada yang curiga.

Angka yang sebenarnya dipakai admin ada di dua tempat lain:
`operasional_rekap.operasional` bila diisi manual, atau turunan
`tonase × 1000` bila tidak (`OperasionalController@index`).

**Diputuskan: `operasional_rekap.operasional`.** Itu satu-satunya dari
ketiganya yang benar-benar diketik manusia. `tonase × 1000` ditolak karena
1000 adalah tarif yang tertanam di controller — kalau tarifnya berubah,
laporan keuangan ikut berubah tanpa jejak dan tanpa ada yang menyetujuinya.
Memperbaiki kolom `transaksi_operasional.operasional` tetap layak dilakukan di
sisi Laravel, tetapi tidak menolong di sini: data lama sudah di-nol-kan
migrasi dan tidak bisa dipulihkan.

Konsekuensi yang harus terlihat, bukan disembunyikan: rute yang baris rekapnya
tidak diisi menghasilkan `COGS_OPS` lebih kecil. `jumlah_sumber.rekap` ada di
respons supaya `rekap: 0` pada bulan yang jelas ada kegiatannya langsung
terbaca sebagai angka yang belum lengkap.

### Dua jalur input, satu angka per rute

Selain `transaksi_operasional` per kegiatan, ada `operasional_rekap` — satu
baris per (`bulan`, `tahun`, `kapal_id`) berisi `sangu_supir`, `terpal`,
`operasional`, dan `tonase`.

Layar Laporan Operasional tidak menjumlahkan keduanya. Ia memilih salah satu
per (kapal, rute): agregat `transaksi_operasional` bila nilainya > 0, kalau
tidak baris rekap manual.

**Diputuskan: endpoint mengikuti aturan yang sama.** Untuk `COGS_SAKU` dan
`COGS_TERPAL`, per (kapal, rute), pakai agregat transaksi bila > 0, kalau
tidak pakai rekap. Menjumlahkan kedua tabel akan menghitung ganda rute yang
punya keduanya; memakai transaksi saja membuat rute rekap-saja hilang tanpa
pesan apa pun. Alasan utamanya keterlacakan, sama seperti pemilihan kolom
`tanggal` di atas: angka portal keuangan harus sama dengan angka yang dilihat
admin, atau selisihnya akan diperdebatkan setiap bulan.

Dua hal yang aturan ini **tidak** selesaikan, dan karena itu dilaporkan
endpoint apa adanya:

- `operasional_rekap` tidak punya kolom `pendapatan`. Rute yang hanya punya
  rekap karena itu menyumbang `COGS_SAKU` dan `COGS_TERPAL` tetapi **nol** ke
  `COGS_REKANAN`. Rutenya disebut satu per satu di `rute_rekap_saja` supaya
  penginput tahu bagian mana dari beban rekanan yang belum tercatat.
- `paguyuban` hanya lahir dari transaksi (`updateOrCreate` berdasarkan
  `transaksi_id`, tidak ada kaitan ke rekap), jadi kegiatan yang tercatat
  sebagai rekap saja tidak punya baris paguyuban sama sekali. `rute_rekap_saja`
  menandai ini juga.

Keduanya tidak memblokir sinkronisasi. Kalau memblokir, bulan yang wajar pun
akan tertahan terus-menerus selama rekap manual masih jadi pola kerja normal —
dan tombol yang selalu gagal akan diabaikan, bukan diperbaiki.

### Tiga jenis baris di `gaji_telly`

`gaji_telly` tidak punya kolom tanggal. Bulannya harus disimpulkan, dan caranya
berbeda untuk tiap jenis baris:

| Baris | Penanda | Bulan diambil dari |
|---|---|---|
| upah telly per kegiatan | `transaksi_id` terisi | `transaksi_operasional.tanggal` |
| upah telly per rekap | `operasional_rekap_id` terisi | `operasional_rekap.bulan`/`tahun` |
| gaji admin bulanan | keduanya `null` | `created_at` — lihat di bawah |

`sum(gaji_bersih)` polos karena itu tidak punya filter bulan sama sekali, dan
menarik gaji admin masuk ke `COGS_TELLY` padahal itu `OPEX_GAJI`.

`COGS_TELLY` hanya mengambil dua jenis pertama. Baris gaji admin **tidak
ikut**: bulannya bersandar pada `created_at` — waktu baris dibuat, bukan bulan
gajinya — dan `LaporanController` baris 1732–1740 bahkan menjumlahkan seluruh
baris tanpa filter kalau bulan itu nol. Keduanya tidak layak jadi sumber angka
laporan keuangan.

### Gaji tercatat di dua tempat

`LaporanController` baris 1745 memakai `max(totalGajiAllKaryawan,
$gajiPengeluaran)` — bukan penjumlahan. Itu menandakan gaji yang sama dicatat
di `gaji_telly` **dan** sebagai baris `pengeluaran` dengan `jenis` mengandung
"gaji", dan Laravel menghindari hitung ganda dengan mengambil yang terbesar.

Menebak mana yang benar lewat `max()` bukan kebijakan yang boleh ditiru. Selama
`pengeluaran_line_mapping` memetakan jenis yang mengandung "gaji" ke
`OPEX_GAJI` sementara `COGS_TELLY` mengambil dari `gaji_telly`, ada risiko
nominal yang sama muncul dua kali di laporan.

**Diputuskan: upah telly hanya di `gaji_telly`, gaji lain hanya di
`pengeluaran`.** Tiap nominal punya satu rumah, jadi `COGS_TELLY` dan
`OPEX_GAJI` tidak bisa memuat angka yang sama. `max()` ditolak karena ia
menebak: pada bulan ketika upah telly dan gaji admin memang dua pos yang
berbeda, salah satunya hilang begitu saja.

Yang harus menyusul di sisi Laravel supaya keputusan ini benar-benar berlaku,
bukan sekadar tertulis di sini:

- hentikan pembuatan baris "Gaji Admin Bulanan" di `gaji_telly`
  (`LaporanController` baris 403) — gaji admin dicatat sebagai `pengeluaran`
- ganti `max(totalGajiAllKaryawan, $gajiPengeluaran)` di baris 1745 menjadi
  penjumlahan biasa, setelah tidak ada lagi baris yang tumpang tindih

Sampai keduanya dikerjakan, endpoint tetap aman: `COGS_TELLY` sudah menyaring
baris gaji admin keluar, jadi angkanya benar meski Laravel masih menyimpannya
di tabel itu. `jumlah_sumber.gaji_telly` tetap ditampilkan supaya penginput
melihat berapa baris yang ikut terhitung.

### `transaksi_operasional.pendapatan` adalah beban, bukan pendapatan

Kolomnya bernama `pendapatan`, tetapi isinya `tonase × ongkos_angkut` dan
dijumlahkan per **pemilik kendaraan** di Laporan Partner, tempat
`laba_bersih = pendapatan − (sangu_supir + terpal)` dihitung. Itu pendapatan
dari sudut pandang partner — yaitu **uang yang ILJ bayarkan ke pemilik truk**.
Dikonfirmasi pemilik sistem, dan konsisten dengan CONTEXT.md yang menyebut
`COGS_REKANAN` sebagai pembayaran ke pemilik kapal/truk, ~83% dari tagihan.

`LaporanController@keuangan` di Laravel memperlakukan kolom yang sama sebagai
pendapatan dan menguranginya dengan biaya untuk mendapat "laba bersih". Itu
salah label dan menghasilkan angka yang tidak berarti. Di luar cakupan tugas
ini, tetapi harus diperbaiki di sisi Laravel — jangan dijadikan rujukan saat
menulis endpoint.

### Pendapatan: bruto atau neto

`REV_TAGIHAN` mengambil `total`, bukan `net_tagihan`. Ini **bukan** keputusan
kebijakan — A-1 tetap terbuka. `total` adalah nominal tagihan dan `pajak`
dilaporkan terpisah sebagai `COGS_PAJAK`; memakai `net_tagihan` akan
menghitung pajak dua kali. Kalau A-1 nanti diputuskan "agen/neto", yang
berubah adalah bentuk laporan, bukan sumber angkanya.

## Yang perlu ditambahkan di Laravel

Satu endpoint baca-saja, satu tabel pemetaan, dan satu berkas rute. Tidak ada
yang dihapus.

### 1. Grup rute `api`

`routes/api.php` belum ada — `bootstrap/app.php` hanya mendaftarkan `web`,
`commands`, dan `health`. Tambahkan berkasnya dan daftarkan:

```php
->withRouting(
    web: __DIR__.'/../routes/web.php',
    api: __DIR__.'/../routes/api.php',
    commands: __DIR__.'/../routes/console.php',
    health: '/up',
)
```

Jangan pakai `php artisan install:api`: perintah itu memasang Sanctum beserta
tabel token dan migrasinya, sementara autentikasi di sini satu token statis
yang dibandingkan `hash_equals`.

Jangan pula menumpangkan rutenya ke `web.php`. Di sana ia ikut middleware
`web` — sesi, cookie, CSRF, dan `SecurityHeaders` — padahal pemanggilnya mesin
tanpa sesi. Rute `api/activity-logs` yang sudah ada memang tinggal di `web.php`
di dalam grup `role:admin`, tetapi itu dipanggil browser yang sudah login;
bukan kasus yang sama.

### 2. Tabel `pengeluaran_line_mapping`

`pengeluaran.jenis` adalah teks bebas — form mengisi dropdown-nya dari
`select distinct jenis`, jadi kosakatanya tumbuh setiap kali admin mengetik
sesuatu yang baru. Tanpa pemetaan eksplisit, biaya baru akan hilang diam-diam.

```
id, jenis (unique), line_code, created_at, updated_at
```

Isi awalnya dari `select distinct jenis from pengeluaran`, dipetakan manual
sekali. Jenis yang muncul setelah itu dan belum dipetakan akan menghentikan
sinkronisasi — itu perilaku yang diinginkan, bukan gangguan.

### 3. `GET /api/integrasi/rekap-bulanan?bulan=&tahun=`

Baca-saja. Tidak mengubah apa pun. Autentikasi lewat header
`Authorization: Bearer <token>` dengan token panjang di `.env`, dibandingkan
memakai `hash_equals`. Route di luar grup `role:admin` — pemanggilnya mesin,
bukan sesi.

```json
{
  "periode": "2026-08",
  "dihitung_pada": "2026-09-20T10:00:00+07:00",
  "baris": {
    "REV_TAGIHAN":    "241500000.00",
    "COGS_PAJAK":     "4830000.00",
    "COGS_REKANAN":   "200445000.00",
    "COGS_SAKU":      "0.00",
    "COGS_TERPAL":    "1450000.00",
    "COGS_OPS":       "4100000.00",
    "COGS_TELLY":     "3200000.00",
    "COGS_PAGUYUBAN": "750000.00",
    "OPEX_GAJI":      "9500000.00",
    "OPEX_SEWA":      "1500000.00"
  },
  "jenis_belum_dipetakan": [],
  "rute_rekap_saja": [
    { "kapal": "KM Sinar Jaya", "rute": "Gresik–Banjarmasin" }
  ],
  "jumlah_sumber": {
    "invoice": 26, "transaksi": 140, "rekap": 12,
    "pengeluaran": 18, "gaji_telly": 14
  }
}
```

Aturan yang mengikat:

- **Nominal selalu string dua desimal.** Lihat invarian 3.
- **`jenis_belum_dipetakan` tidak kosong ⇒ HTTP 200 tetap, tapi IMR_keu menolak
  menulis** dan menampilkan daftarnya. Endpoint melapor apa adanya; portal yang
  memutuskan. Ini memisahkan "sistem operasional bilang apa" dari "portal
  keuangan boleh menyimpan apa".
- **Baris bernilai nol tetap dikirim.** Nol berarti "sudah dihitung, hasilnya
  nol"; baris yang hilang berarti "tidak diketahui". Dua hal berbeda.
- **Tidak ada subtotal di respons.** Invarian 2.
- **`rute_rekap_saja` memperingatkan, tidak memblokir.** Daftar (kapal, rute)
  yang angkanya diambil dari rekap karena tidak ada transaksi. Untuk rute itu
  `COGS_REKANAN` nol dan `COGS_PAGUYUBAN` tidak ada, bukan karena nilainya nol
  melainkan karena tabelnya tidak menyimpannya. Layar input menampilkannya;
  yang memutuskan apakah itu bisa diterima adalah orang, bukan endpoint.
- **`jumlah_sumber` bukan hiasan.** Layar input menampilkannya supaya penginput
  tahu angka itu berasal dari 26 invoice, bukan dari nol invoice. `rekap` dan
  `gaji_telly` ikut di sana karena keduanya jalur input yang mudah terlupakan —
  `rekap: 12` sementara `transaksi: 0` berarti bulan itu diinput sebagai rekap
  manual, dan angkanya belum tentu lengkap.

### 4. Perbaikan label di `LaporanController@keuangan`

Terpisah dari endpoint, tapi sebaiknya sekalian: kolom `pendapatan` di sana
dilabeli pendapatan padahal beban. Selama itu dibiarkan, dua sistem akan
menampilkan dua "laba bersih" yang berbeda untuk bulan yang sama, dan yang
ditanya duluan pasti yang salah.

## Yang perlu ditambahkan di IMR_keu

### 1. Migration — template v2

`COGS_TELLY` dan `COGS_PAGUYUBAN` belum ada di template trucking. Template
yang sudah dipakai periode non-draft **beku** (lihat `CLAUDE.md`), jadi jalur
satu-satunya adalah menggandakan ke versi baru:

- `report_templates` versi 2 untuk `business_line = 'trucking'`
- salin seluruh baris v1, tambah `COGS_TELLY` dan `COGS_PAGUYUBAN`
  (section `cogs`), beri `sort_order` setelah `COGS_OPS`
- periode lama tetap menunjuk `template_id` v1 dan terbaca persis seperti
  sebelumnya

### 2. Migration — kolom `source` di `report_lines`

Baris hasil tarik data dan baris yang diketik manual saat ini tidak bisa
dibedakan. Tanpa itu, pengulas tidak bisa tahu angka mana yang sudah dikoreksi
manusia dan mana yang mentah dari Laravel — persis informasi yang dicari saat
angkanya diperdebatkan.

```sql
alter table report_lines
  add column source text not null default 'manual'
  check (source in ('manual', 'operasional', 'import'));
```

`not null default 'manual'` supaya baris lama dan seluruh jalur tulis yang ada
tidak perlu diubah. `'import'` disediakan untuk hasil `import-ilj.ts`; isi
baris historis lewat `update` terpisah bila diperlukan, bukan lewat default.

Kolom ini **tidak** mengubah invarian 2: ia menjelaskan asal sebuah baris
input, bukan menyimpan subtotal. Koreksi manual atas baris hasil tarik data
mengubah `source` kembali ke `'manual'` — itu yang menandai bahwa angkanya
sudah disentuh orang.

### 3. Migration — `operational_sync_config`

Menyimpan URL dasar dan entitas mana yang ditautkan ke sistem operasional.
Token **tidak** disimpan di sini — token ada di `$env/static/private` supaya
tidak pernah ikut ke klien, sejalan dengan cara service role key ditangani di
`/admin/users`.

Tabel baru wajib punya policy RLS (invarian 1): baca untuk yang berhak atas
entitasnya, tulis hanya `direksi`. Policy saja tidak cukup — RLS mempersempit
hak akses, bukan memberikannya, dan tabel yang dibuat lewat migrasi tidak
mewarisi `grant` apa pun. Tanpa `grant ... to authenticated`, setiap query
gagal `42501` betapapun benar policy-nya.

### 4. Action `tarikOperasional` di `/entry/[period]`

Di `+page.server.ts`, bersebelahan dengan action simpan yang sudah ada.
Urutannya:

1. tolak kalau peran bukan `staf_entitas` yang berhak atas entitas itu
2. tolak kalau entitas ini tidak ditautkan ke sistem operasional
3. panggil endpoint Laravel dengan token dari `$env/static/private`
4. kalau `jenis_belum_dipetakan` tidak kosong → `fail(409)` dengan daftarnya,
   jangan tulis apa pun
5. kalau ada `line_code` yang tidak ada di template periode → `fail(409)`,
   jangan tulis sebagian. Menulis separuh laporan lebih buruk daripada gagal.
6. `upsert` ke `report_lines` on conflict `(period_id, line_code)`, dengan
   `source = 'operasional'`
7. trigger `guard_period_editable` akan menolak kalau periode bukan draft —
   teruskan pesannya apa adanya, ia sudah berbahasa Indonesia (`P0001`)

Idempoten: menekan tombol dua kali menghasilkan angka yang sama.

### 5. Tombol di `+page.svelte`

Di kepala layar input, dengan konfirmasi sebelum menimpa: kalau sudah ada
baris terisi, tarik data akan mengganti angkanya. Setelah berhasil, tampilkan
`jumlah_sumber` dan waktu tarik, dan `rute_rekap_saja` bila tidak kosong —
peringatan yang hanya ada di respons JSON sama saja dengan tidak ada.

## Pengujian

Ikuti pola `docs/task/05-regression-tests.md`. Yang wajib ada:

- tarik data pada periode `submitted` ditolak trigger, dan pesannya sampai ke
  layar
- `jenis_belum_dipetakan` tidak kosong ⇒ tidak ada satu pun baris tertulis
- rute dengan transaksi **dan** rekap ⇒ dihitung sekali, dari transaksi
- rute dengan rekap saja ⇒ nilainya ikut, dan rutenya muncul di
  `rute_rekap_saja`
- baris `gaji_telly` tanpa `transaksi_id` dan tanpa `operasional_rekap_id`
  tidak ikut ke `COGS_TELLY`
- baris `gaji_telly` bulan lain tidak ikut, lewat kedua jalur penanggalan
- baris hasil tarik data tersimpan dengan `source = 'operasional'`; baris yang
  kemudian dikoreksi lewat form kembali ke `'manual'`
- `line_code` di luar template ⇒ tidak ada satu pun baris tertulis
- tarik dua kali ⇒ hasil identik
- nominal string `"200445000.00"` masuk sebagai `200445000.00`, bukan float
- staf entitas A tidak bisa menarik data untuk entitas B

## Keputusan 20 September 2026

Empat hal yang tidak bisa disimpulkan dari kode. Dicatat di sini supaya yang
membaca dokumen ini setahun lagi tahu bahwa ini dipilih, bukan kebetulan.

| # | Keputusan | Alasan singkat |
|---|---|---|
| 1 | `COGS_OPS` dari `operasional_rekap.operasional` | satu-satunya angka yang diketik manusia; `tonase × 1000` adalah tarif tertanam di controller |
| 2 | `COGS_SAKU`/`COGS_TERPAL` ikut aturan layar: transaksi bila > 0, kalau tidak rekap | angka portal harus sama dengan Laporan Operasional; menjumlahkan keduanya menghitung ganda |
| 3 | upah telly hanya di `gaji_telly`, gaji lain hanya di `pengeluaran` | `max()` menebak; satu rumah per nominal menghapus risiko hitung ganda |
| 4 | tambahkan kolom `source` di `report_lines` | tanpa itu, angka hasil tarik dan angka yang sudah dikoreksi tidak bisa dibedakan |

Keputusan 1 dan 2 mengandaikan admin operasional mengisi `operasional_rekap`
dengan disiplin. Kalau di lapangan ternyata tidak, `jumlah_sumber.rekap` dan
`rute_rekap_saja` yang akan menunjukkannya lebih dulu — tinjau ulang keduanya
setelah dua atau tiga bulan berjalan, jangan menunggu selisihnya ditemukan
saat tutup tahun.

Keputusan 3 baru tuntas setelah dua perubahan di sisi Laravel yang disebut di
"Gaji tercatat di dua tempat" dikerjakan.

## Belum diputuskan

**Nama legal dan NPWP ILJ.** `CONTEXT.md` mencatat "PT Indra Langgeng Jaya",
sistem operasional mencetak "PT Indo Moda Raya". Pemilik sistem
mengonfirmasi keduanya entitas yang sama; nama mana yang resmi belum
dipastikan. `entities.legal_name`, `entities.npwp`, dan CONTEXT.md diselaraskan
setelah itu jelas.
