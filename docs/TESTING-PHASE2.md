# Uji end-to-end Fase 2

Tugas 3 (impor ILJ), 4 (layar P&L) dan 5 (tes regresi), diuji lewat layar.

Setiap angka di bawah ini diambil dari fixture bersih yang benar-benar
dijalankan, bukan ditulis dari ingatan. Kalau layar Anda menampilkan angka
lain, salah satunya salah — cek dulu bahwa fixture-nya memang bersih
(lihat [Sebelum mulai](#sebelum-mulai)).

Dua dokumen uji lain masih berlaku dan tidak diulang di sini:

| File | Isi |
|---|---|
| [`TESTING.md`](TESTING.md) | Sesi, login, redirect, dan Dasbor Eksekutif |
| [`TESTING-WORKFLOW.md`](TESTING-WORKFLOW.md) | Layar Input Laporan dan Persetujuan, dari draft sampai kunci |

---

## Sebelum mulai

```sh
supabase start
npm run db:reset
npm run dev              # http://localhost:5173
```

> **`npm test` mengotori fixture.** Tiap file tes mereset database di awal,
> bukan di akhir, jadi setelah rangkaian selesai database berisi periode
> buatan file tes terakhir — Anda akan melihat ILJ punya "4 periode tercatat"
> dan laba bersih Januari 2026. Itu bukan bug.
>
> **Urutannya: `npm test` dulu, baru `npm run db:reset`, baru uji layar.**
> Kalau terbalik, semua angka di dokumen ini akan meleset.

Bagian C dan D memakai SQL langsung. Tempel dua helper ini sekali per sesi
shell — `psql_` sama persis dengan yang ada di
[`TESTING.md`](TESTING.md#setup):

```sh
# SQL satu baris.
psql_()   { docker exec supabase_db_IMR_keu psql -U postgres -d postgres "$@"; }

# Menjalankan file .sql dari host. Butuh `-i`, karena file-nya ada di sini,
# bukan di dalam container — `psql_ -f namafile` akan bilang "No such file".
psql_f()  { docker exec -i supabase_db_IMR_keu psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -; }
```

Akun uji ada di `README.md`. Semuanya berpassword `devpassword`, dan hanya ada
di database lokal.

| Login | Peran | Dipakai di bagian |
|---|---|---|
| `staf.ilj@example.test` | Staf Entitas | [B](#bagian-b--isolasi-antar-entitas) |
| `manajer@example.test` | Manajer Keuangan | [A](#bagian-a--layar-laporan-pl-tugas-4) |
| `direksi@example.test` | Direksi | [B](#bagian-b--isolasi-antar-entitas) |
| `auditor@example.test` | Auditor | [B](#bagian-b--isolasi-antar-entitas) |

Uji ini murni baca. Tidak ada satu pun langkah yang mengubah data, kecuali
[Bagian D](#bagian-d--impor-data-ilj-tugas-3), yang sudah ditandai.

---

# Bagian A — Layar Laporan P&L (Tugas 4)

Masuk sebagai **`manajer@example.test`**.

## A.1 Sidebar tidak lagi punya item mati

Sebelum Fase 2, "Laporan P&L" abu-abu dengan label kecil **SEGERA** dan tidak
bisa diklik.

- [ ] "Laporan P&L" bisa diklik dan mengarah ke `/entities`
- [ ] Tidak ada satu pun item sidebar yang abu-abu atau berlabel "segera"
- [ ] Saat berada di layar P&L, item itu tersorot biru

## A.2 Daftar entitas — `/entities`

Empat kartu, urut abjad kode. Cocokkan seluruhnya:

| Kartu | Chip | Angka besar | Baris bawah |
|---|---|---|---|
| **AMDK** *(nama badan hukum belum dikonfirmasi) - lini AMDK* | `amdk` · ⚠ Basis belum ditetapkan | **—** | Belum ada periode yang disetujui · Terbaru Juli 2025 (Diajukan) |
| **GARAM** *(nama badan hukum belum dikonfirmasi) - lini garam* | `salt` · ⚠ Basis belum ditetapkan | **—** | Belum ada laporan |
| **ILJ** *PT Indra Langgeng Jaya* | `trucking` · ⚠ Basis belum ditetapkan | **(Rp 2,2 jt)** | Laba bersih Juli 2025 · 2 periode tercatat |
| **TAMBANG** *(nama badan hukum belum dikonfirmasi) - lini tambang* | `mining` · ⚠ Basis belum ditetapkan | **(Rp 2,4 jt)** | Laba bersih Juli 2025 · 1 periode tercatat |

Yang perlu diperhatikan, satu per satu:

- [ ] **AMDK menampilkan `—`, bukan Rp29,9 jt.** Juli 2025 AMDK sudah diisi dan
      labanya 29.950.000, tapi statusnya masih Diajukan. Kartu ini
      menampilkan **laba periode terakhir yang disetujui**, dan AMDK belum
      punya satu pun. Kalau angkanya muncul di sini, kartu ini menampilkan
      angka yang belum disetujui seolah-olah sudah.
- [ ] **GARAM tidak bisa diklik.** Tidak ada periode sama sekali, jadi tidak
      ada laporan untuk dibuka. Kursor tidak berubah jadi tangan.
- [ ] **Tiga kartu lain bisa diklik** dan berpindah ke laporan periode
      terbarunya.
- [ ] **Semua chip basis berwarna amber** dengan ikon segitiga peringatan.
      Empat entitas masih `unknown` (ASSUMPTIONS.md A-1, A-4). Chip abu-abu
      di sini berarti sistem diam-diam memilih basis pelaporan.
- [ ] Angka negatif dalam kurung: `(Rp 2,2 jt)`, bukan `-Rp 2,2 jt`.

## A.3 Laporan ILJ Juli 2025 — layar utamanya

Klik kartu **ILJ**. Anda mendarat di
`/entities/<id-ilj>/periods/2025-07`.

### Header

- [ ] `← ILJ · PT Indra Langgeng Jaya · Juli 2025` dengan badge **Disetujui**
- [ ] Panah kiri kembali ke `/entities`
- [ ] Pemilih periode di kanan berisi **dua** pilihan: Juli 2025, Juni 2025

### Banner kebijakan (amber, di atas kartu)

- [ ] Berbunyi: *Sebagian kebijakan akuntansi belum ditetapkan — angka
      bersifat sementara.*
- [ ] Menyebut kelimanya:
      `revenue_presentation_trucking, uang_saku_treatment,
      profit_sharing_65_35, accounting_basis, accounting_standard`

Banner ini muncul karena kelima baris `accounting_policies` masih `NULL`.
Menghilangkannya berarti menyajikan angka sementara sebagai angka final.

### Empat kartu ringkasan

| Kartu | Nilai | Keterangan bawah |
|---|---|---|
| Laba Bersih | **(2.178.807)** *merah* | — |
| Margin Bersih | **−0,93%** | — |
| Pendapatan MoM | **−2,7%** *merah* | vs. Juni 2025 |
| Pendapatan YoY | **—** | belum ada data 12 bulan sebelumnya |

- [ ] Laba bersih dalam kurung **dan** merah
- [ ] Tanda minus pada persentase adalah minus sungguhan `−`, bukan hyphen `-`
- [ ] **YoY kosong, dan itu benar.** ILJ baru punya dua bulan. Kalau kolom ini
      terisi, kemungkinan besar ia menampilkan MoM dengan label YoY — persis
      bug yang ada di prototipe.

### Tabel laporan

Kolom: **Pos · Juli 2025 · Juni 2025 · Δ MoM · Kontribusi**

```
Pendapatan                          235.000.000   241.500.000    −2,7%   100,0%   merah
  Tagihan Jasa Angkutan             235.000.000   241.500.000    −2,7%   100,0%   merah
Beban Pokok Pendapatan              222.050.000   210.825.000    +5,3%    94,5%   merah
  Pajak atas Tagihan                 21.300.000     4.830.000  +341,0%     9,1%   merah
  Bagian Rekanan                    195.050.000   200.445.000    −2,7%    83,0%   HIJAU
  Terpal                              1.500.000     1.450.000    +3,4%     0,6%   merah
  Operasional Armada                  4.200.000     4.100.000    +2,4%     1,8%   merah
  Uang Saku Operasional                       0             0        —      0,0%
= Laba Kotor                         12.950.000    30.675.000   −57,8%     5,5%   merah
Beban Usaha                          15.128.807    14.700.000    +2,9%     6,4%   merah
  Gaji Karyawan                       9.500.000     9.500.000    +0,0%     4,0%
  Sewa Kantor                         1.500.000     1.500.000    +0,0%     0,6%
  Beban Kantor & ATK                    750.000       680.000   +10,3%     0,3%   merah
  Jasa Profesional                    1.250.000     1.250.000    +0,0%     0,5%
  Perizinan & Retribusi                 850.000       850.000    +0,0%     0,4%
  Beban Operasional Lain              1.278.807       920.000   +39,0%     0,5%   merah
= Laba Operasi                       (2.178.807)   15.975.000  −113,6%    −0,9%   merah
= Laba Bersih                        (2.178.807)   15.975.000  −113,6%    −0,9%   merah
```

Empat hal yang paling penting di tabel ini:

- [ ] **Baris `Bagian Rekanan` hijau meski turun.** Ini beban, dan beban yang
      turun adalah kabar baik. Kalau baris ini merah, pewarnaan Δ tidak
      dibalik untuk beban dan seluruh kolom ini menyesatkan pembaca.
- [ ] **`Pendapatan` turun 2,7% berwarna merah**, sedangkan `Bagian Rekanan`
      yang juga turun 2,7% berwarna hijau. Persentase sama, warna berlawanan
      — itu buktinya pembalikan bekerja per section, bukan per angka.
- [ ] **`Uang Saku Operasional` bernilai 0** dengan catatan kecil abu-abu di
      bawahnya: *Historis nihil - perlakuan uang saku belum diputuskan (A-2)*.
      Catatan baris memang dimaksudkan untuk terlihat.
- [ ] **Tiga baris subtotal** (`= Laba Kotor`, `= Laba Operasi`,
      `= Laba Bersih`) punya garis atas lebih tebal dan huruf tebal.

Dan yang mudah salah baca:

- [ ] `Laba Operasi` dan `Laba Bersih` **sama-sama (2.178.807)**. Itu benar:
      ILJ tidak melaporkan pendapatan lain-lain, beban lain-lain, maupun pajak
      penghasilan bulan ini, jadi tidak ada yang mengurangi laba operasi lagi.
      Ketiga section itu memang tidak muncul di tabel — section yang tidak
      dilaporkan tidak ditampilkan sebagai deretan nol.
- [ ] Baris yang nilainya **tidak berubah** (`+0,0%`) berwarna hijau. Nol
      dianggap "tidak memburuk". Aneh dilihat, tapi konsisten dengan aturan
      pembalikan di atas — bukan temuan.
- [ ] `Pajak atas Tagihan` melonjak **+341,0%** karena PPh 23 Januari–Maret
      baru dibayar Juli. Catatan di bawah barisnya menjelaskan itu; ini
      artefak basis kas (A-4), bukan salah hitung.

### Verifikasi subtotal langsung ke sumbernya

Subtotal wajib berasal dari `v_period_pnl`, bukan dijumlahkan di layar
(invarian 2). Bandingkan langsung:

```sh
psql_ -c "select revenue::bigint, cogs::bigint, gross_profit::bigint,
                 opex::bigint, operating_profit::bigint, net_profit::bigint,
                 net_margin_pct
            from v_period_pnl
           where entity_code='ILJ' and period='2025-07-01';"
```

```
 revenue    | cogs      | gross_profit | opex     | operating_profit | net_profit | net_margin_pct
 235000000  | 222050000 | 12950000     | 15128807 | -2178807         | -2178807   | -0.93
```

- [ ] Keenam angka identik dengan yang di layar

## A.4 Periode pertama — Juni 2025

Ganti pemilih periode ke **Juni 2025**.

- [ ] Judul kolom ketiga berubah jadi **"Periode lalu"**, bukan nama bulan —
      tidak ada Mei 2025 untuk dibandingkan
- [ ] Seluruh kolom `Periode lalu` dan `Δ MoM` berisi **—**
- [ ] Kartu Pendapatan MoM: **—**, keterangan *tidak ada bulan pembanding*
- [ ] Kartu Pendapatan YoY: **—**, keterangan *belum ada data 12 bulan
      sebelumnya*
- [ ] Laba Bersih **15.975.000**, margin **6,61%**, keduanya tidak merah

Baris kuncinya:

```
Pendapatan          241.500.000   —   —   100,0%
= Laba Kotor         30.675.000   —   —    12,7%
= Laba Operasi       15.975.000   —   —     6,6%
= Laba Bersih        15.975.000   —   —     6,6%
```

- [ ] **`—`, bukan `0` dan bukan `0,0%`.** Tidak ada data bukan nol. Kalau
      kolom ini menampilkan 0, layar mengaku punya pembanding yang tidak ada.

## A.5 Entitas yang belum disetujui tetap bisa dibaca

Buka **AMDK**, Juli 2025 (lewat `/entities`, kartu AMDK bisa diklik).

- [ ] Badge status **Diajukan**, bukan Disetujui
- [ ] Laporannya tetap tampil penuh: Pendapatan 112.750.000, Laba Bersih
      **29.950.000**
- [ ] Semua kolom pembanding **—** (AMDK hanya punya satu periode)

Ini disengaja: reviewer harus bisa membaca laporan sebelum menyetujuinya.
Yang tidak boleh adalah angka ini masuk konsolidasi — dan itu diuji di
Dasbor (`TESTING.md`), bukan di sini.

## A.6 Entitas tanpa pembanding — TAMBANG

Buka **TAMBANG**, Juli 2025.

```
Pendapatan             96.400.000   —   —   100,0%
Beban Pokok Pendapatan 73.728.000   —   —    76,5%
= Laba Kotor           22.672.000   —   —    23,5%
Beban Usaha            25.100.000   —   —    26,0%
= Laba Bersih          (2.428.000)  —   —    −2,5%
```

- [ ] Kontribusi **−2,5%** ditampilkan sebagai angka negatif
- [ ] Bar kecil di kolom Kontribusi **kosong**, tidak meluber ke kiri atau
      memenuhi jalurnya. Bar di-clamp 0–100; angkanya tidak. Prototipe dulu
      menulis `width: ${pct}%` tanpa batas dan bar-nya jebol.

## A.7 Rute yang tidak sah

Semua ini harus **404**, bukan 500 dan bukan halaman kosong:

- [ ] `/entities/not-a-uuid/periods/2025-07`
- [ ] `/entities/<id-ilj>/periods/2025-13`
- [ ] `/entities/<id-ilj>/periods/2020-01` — periode yang tidak ada

Id ILJ bisa diambil dengan:

```sh
psql_ -qAt -c "select id from entities where code='ILJ';"
```

---

# Bagian B — Isolasi antar entitas

Bagian yang paling penting di dokumen ini. Kegagalannya berarti satu PT
membaca buku PT lain.

Ambil dulu dua id:

```sh
psql_ -qAt -c "select code || ' ' || id from entities where code in ('ILJ','TAMBANG');"
```

## B.1 Staf entitas hanya melihat miliknya

Keluar, masuk sebagai **`staf.ilj@example.test`**.

- [ ] `/entities` menampilkan **satu kartu saja**: ILJ
- [ ] Tidak ada pesan khusus semacam "Anda hanya punya akses ke satu entitas".
      Satu kartu memang jawaban yang benar; menambahkan penjelasan justru
      menyiratkan ada yang disembunyikan
- [ ] Sidebar: Laporan P&L dan Input Laporan. **Tidak ada** Dasbor Eksekutif
- [ ] `/entities/<id-ilj>/periods/2025-07` terbuka normal
- [ ] `/entities/<id-tambang>/periods/2025-07` → **404**

> Harus 404, bukan halaman kosong. RLS membuat entitas lain mengembalikan nol
> baris; kalau layar merendernya sebagai laporan kosong, staf ILJ akan
> menyimpulkan TAMBANG belum melapor — padahal ia hanya tidak boleh melihatnya.

## B.2 Auditor membaca semua, mengubah nol

Keluar, masuk sebagai **`auditor@example.test`**.

- [ ] `/entities` menampilkan **empat kartu**
- [ ] `/entities/<id-tambang>/periods/2025-07` terbuka
- [ ] Di seluruh layar P&L **tidak ada satu pun tombol atau field** — tidak
      ada tombol simpan, setujui, atau ubah. Yang ada hanya pemilih periode
      dan tautan
- [ ] Sidebar: Dasbor Eksekutif dan Laporan P&L. Tidak ada Input Laporan,
      tidak ada Persetujuan

Layar ini read-only secara bentuk, bukan karena tombolnya di-disable. Satu-
satunya `<form>` di halaman adalah tombol keluar di sidebar:

```sh
curl -s -b "$JARS/cj.auditor" "$APP/entities/$ILJ/periods/2025-07" \
  | grep -o '<form[^>]*action="[^"]*"'
#  <form method="POST" action="/logout"
```

## B.3 Direksi

Masuk sebagai **`direksi@example.test`**.

- [ ] Empat kartu, semua entitas bisa dibuka
- [ ] Sama seperti auditor, layar P&L tidak menawarkan aksi apa pun —
      layar ini memang hanya membaca, apa pun perannya

---

# Bagian C — Tes regresi otomatis (Tugas 5)

Bagian ini dijalankan di terminal, bukan di layar. Tetap dimasukkan karena
inilah yang menggantikan sebagian besar checklist manual.

## C.1 Rangkaian hijau dari fixture bersih

```sh
npm run db:reset
npm test
```

- [ ] `Test Files  6 passed (6)`
- [ ] `Tests  112 passed (112)`
- [ ] Selesai di bawah 60 detik — nyatanya sekitar **4 detik**

Isinya:

| File | Menjaga |
|---|---|
| `rls.test.ts` | Siapa melihat apa, termasuk profil yang dinonaktifkan |
| `workflow.test.ts` | Transisi status, pemisahan tugas, kunci |
| `guards.test.ts` | `line_code`, insert periode, audit append-only |
| `views.test.ts` | Aritmetika view, eliminasi, kelengkapan |
| `format.test.ts` | Rupiah, kurung, em dash, minus |
| `import-ilj.test.ts` | Parser ILJ terhadap workbook sintetis |

## C.2 Buktikan tesnya benar-benar menangkap sesuatu

Rangkaian yang selalu hijau tidak membuktikan apa pun sampai Anda melihatnya
merah. Hapus satu trigger, lalu jalankan ulang:

```sh
psql_ -c "drop trigger report_lines_template_guard on report_lines;"
npx vitest run tests/guards.test.ts
```

- [ ] **4 tes gagal**, semuanya di `guard_line_code_in_template`

Kembalikan:

```sh
psql_ -c "create trigger report_lines_template_guard
            before insert or update on report_lines
            for each row execute function guard_line_code_in_template();"
npm test
```

- [ ] Hijau lagi, 112/112

Trigger inilah yang mencegah kegagalan paling senyap di sistem ini: satu kode
baris salah ketik membuat nominalnya hilang dari pendapatan, beban, **dan**
laba bersih sekaligus — laporannya tetap "seimbang" dan tetap salah.

## C.3 Setelah selesai

```sh
npm run db:reset
```

- [ ] ILJ kembali punya **2 periode tercatat** di `/entities`

Wajib, kalau Anda mau lanjut menguji layar. Lihat catatan di
[Sebelum mulai](#sebelum-mulai).

---

# Bagian D — Impor data ILJ (Tugas 3)

> **Bagian ini mengubah data.** Semuanya bisa dibatalkan dengan
> `npm run db:reset`.

Parser sudah selesai dan teruji, tapi **belum pernah dijalankan terhadap file
aslinya** — `Presentasi_Rekap_Income_Full_ILJ__Revisi_FIX.xlsx` tidak ada di
repo. Bagian D.1 adalah latihan yang bisa dijalankan hari ini; D.2 adalah yang
sebenarnya, begitu filenya ada.

## D.1 Latihan dengan workbook sintetis

Membuat file Excel yang bentuknya meniru file klien — lengkap dengan setiap
jebakannya — lalu menjalankan seluruh jalur impor sampai angkanya muncul di
layar. Angkanya karangan; bentuk filenya tidak.

Tempel ini di terminal, dari root repo:

```sh
cat > _fixture.mjs <<'EOF'
import * as XLSX from 'xlsx';
const sheet = (cells) => {
  const s = {}; let mr = 0, mc = 0;
  for (const [ref, v] of Object.entries(cells)) {
    const { r, c } = XLSX.utils.decode_cell(ref);
    mr = Math.max(mr, r); mc = Math.max(mc, c);
    s[ref] = typeof v === 'number' ? { t: 'n', v }
           : typeof v === 'string' ? { t: 's', v }
           : { t: 'e', v: 0x2a, w: '#N/A' };
  }
  s['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: mr, c: mc } });
  return s;
};
const inv = (row, d) => {
  const c = { [`B${row}`]: d.invoice };
  for (const [col, v] of [['H', d.tagihan], ['I', d.pajak], ['J', d.saku],
                          ['K', d.terpal], ['L', d.ops], ['M', d.rekanan]])
    if (v !== undefined) c[`${col}${row}`] = v;
  if (typeof d.tagihan === 'number') c[`N${row}`] = d.tagihan * 0.05;  // subtotal, jangan diimpor
  return c;
};
const block = (col, row, valCol, rows) => {
  const c = { [`${col}${row}`]: 'Laporan Laba Rugi' };
  rows.forEach(([label, amt], i) => { c[`${col}${row + 1 + i}`] = label; c[`${valCol}${row + 1 + i}`] = amt; });
  return c;
};
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheet({
  A1: 'NO', B1: 'NO INVOICE', H1: 'TAGIHAN', I1: 'PAJAK', J1: 'SAKU',
  K1: 'TERPAL', L1: 'OPERASIONAL', M1: 'REKANAN', N1: 'PROFIT OPS',
  B3: 'NOVEMBER',
  ...inv(4, { invoice: '01/ILJ/NOVEMBER/2024', tagihan: 100000000, pajak: 2000000, terpal: 500000, ops: 1500000, rekanan: 83000000 }),
  ...inv(5, { invoice: '02/ILJ/NOVEMBER/2024', tagihan: 50000000, pajak: 1000000, terpal: 250000, ops: 750000, rekanan: 41500000 }),
  B7: 'DESEMBER',
  ...inv(8, { invoice: '03/ILJ/DESEMBER/2024', tagihan: 80000000, pajak: 1600000, ops: 1200000, rekanan: 66400000 }),
  B9: 'JANUARI',
  ...inv(10, { invoice: '017B/JANUARI', tagihan: 30000000, pajak: 600000, terpal: 150000, ops: 450000, rekanan: 24900000 }),
  ...inv(11, { invoice: '017B/JANUARI', tagihan: 20000000, pajak: 400000, terpal: 100000, ops: 300000, rekanan: 16600000 }),
  B12: 'MARET',
  ...inv(13, { invoice: '05/ILJ/MARET/2025', tagihan: 60000000, pajak: 1200000, terpal: 300000, ops: 900000, rekanan: 49800000 }),
  ...inv(14, { invoice: '06/ILJ/MARET/2024', tagihan: 4935040, pajak: 98700, rekanan: 4096083 }),
  B15: 'JULI',
  ...inv(16, { invoice: '026/ILJ/JULI-2025', tagihan: 100000000, pajak: 9000000, saku: 44000000, terpal: 700000, ops: 2000000, rekanan: 83000000 }),
  ...inv(17, { invoice: '030/ILJ-JULI-2025', tagihan: 135416417, pajak: 12300000, saku: 59985000, terpal: 800000, ops: 2200000, rekanan: 112395626 }),
  ...inv(18, { invoice: '044/ILJ/JULI-2025', tagihan: 0, rekanan: { error: 1 } }),
  H19: 235416417, N19: 11770820        // <- baris TOTAL, tanpa nomor invoice
}), 'DATABASE KPL');
XLSX.utils.book_append_sheet(wb, sheet(block('Z', 10, 'AB', [['Beban Usaha', 0], ['Gaji Karyawan', 9000000], ['Sewa Kantor', 1500000], ['Total Beban Usaha', 10500000], ['Pendapatan Bersih', 9000000]])), 'Nov 24');
XLSX.utils.book_append_sheet(wb, sheet(block('Z', 12, 'AB', [['Gaji Karyawan', 9000000], ['Beban Kantor & ATK', 400000], ['Pendapatan Bersih', 1400000]])), 'Des 24');
XLSX.utils.book_append_sheet(wb, sheet(block('AC', 8, 'AE', [['Gaji Karyawan', 5000000], ['Laba Bersih', 1500000]])), 'Jan 25');
XLSX.utils.book_append_sheet(wb, sheet(block('T', 15, 'V', [['Gaji Karyawan', 6000000], ['Perizinan & Retribusi', 500000], ['Pendapatan Bersih', 2040257]])), 'Mar 25');
XLSX.utils.book_append_sheet(wb, sheet(block('L', 20, 'N', [['Gaji Karyawan', 9500000], ['Sewa Kantor', 1500000], ['Beban Kantor & ATK', 750000], ['Jasa Konsultan Pajak', 1250000], ['Perizinan & Retribusi', 850000], ['Biaya Lain-lain', 1349598], ['Pendapatan Bersih', -2178807]])), 'Jul 25');
XLSX.writeFile(wb, 'latihan-ilj.xlsx');
console.log('latihan-ilj.xlsx dibuat');
EOF
node _fixture.mjs && rm _fixture.mjs
```

Lima bulan, dengan jebakan yang sama seperti file aslinya: baris TOTAL di
baris 19, satu invoice bertahun salah, satu nomor invoice ganda, satu `#N/A`,
dan blok laba rugi yang pindah kolom tiap bulan.

### Jalankan parser

```sh
npx tsx scripts/import-ilj.ts latihan-ilj.xlsx --out supabase/seed-latihan.sql
```

Laporan parsing yang harus keluar — cocokkan barisnya:

```
Periode diproses      : 5
Invoice diproses      : 10
Baris kosong dilewati : 2 (memang kosong, tanpa rincian)
Baris sebelum bulan 1 : 1 (header sheet)
  baris 1 — NO INVOICE
Invoice dilewati      : 1
  baris 19 — tanpa nomor invoice — H=235.416.417 I=0 J=0 K=0 L=0 M=0 N=11.770.820
Sel #N/A jadi nol     : 1
  baris 18 044/ILJ/JULI-2025 REKANAN=#N/A → 0
Nomor invoice ganda   : 1 (dijumlahkan, tidak dibuang)
  017B/JANUARI — baris 10 & 11 — total tagihan 50.000.000
Tahun invoice janggal : 1
  MARET 2025: 1 nomor invoice menyebut tahun 2024 — dipakai 2025 dari pemisah bulan
Label opex tak dikenal: 0
...
Verifikasi laba bersih: 5/5 cocok
  ok    2025-07 — impor -2.178.807 vs sumber -2.178.807 — selisih 0
```

Yang wajib dicek di laporan ini:

- [ ] **Baris 19 dilewati** dan nilainya dicetak. Itu baris TOTAL. Kalau ikut
      terimpor, pendapatan Juli jadi 470.832.834 — dua kali lipat, dan tidak
      ada yang menandainya
- [ ] **`06/ILJ/MARET/2024` masuk Maret 2025**, dan ketidakcocokannya
      dilaporkan sebagai "Tahun invoice janggal". Pemisah bulan yang menang,
      bukan nomor invoice
- [ ] **`017B/JANUARI` dijumlahkan**, tidak ada yang dibuang
- [ ] **`#N/A` jadi nol**, bukan error
- [ ] **Label opex tak dikenal: 0**
- [ ] **Verifikasi 5/5 cocok**, Juli tepat −2.178.807
- [ ] Ada peringatan **PERIKSA DULU** di bawah, karena ada baris dilewati.
      Itu memang harus muncul

Buka `supabase/seed-latihan.sql` dan lihat kepalanya — seluruh laporan di atas
ikut tersimpan sebagai komentar di file, jadi siapa pun yang meninjau SQL-nya
melihat hal yang sama.

### Terapkan dan lihat di layar

```sh
psql_f < supabase/seed-latihan.sql
```

Sekarang buka `/entities` lagi:

- [ ] Kartu **ILJ** menampilkan **6 periode tercatat** — 5 hasil impor
      ditambah Juni 2025 dari seed
- [ ] Pemilih periode di layar laporan berisi enam bulan: Juli 2025,
      Juni 2025, Maret 2025, Januari 2025, Desember 2024, November 2024

Buka **ILJ Juli 2025**:

| Yang dicek | Nilai |
|---|---|
| Pendapatan | **235.416.417** |
| Laba Bersih | **(2.178.807)** |
| Catatan di `Uang Saku Operasional` | *Sumber mencatat Rp103.985.000 di luar laba rugi — ASSUMPTIONS.md A-2* |
| Catatan di `Terpal` | *Diimpor apa adanya dari kolom TERPAL; sumber historis mencatat 50%…* |

- [ ] **Pendapatan 235.416.417, bukan 470.832.834.** Ini bukti baris TOTAL
      tidak ikut terimpor — dan ini satu-satunya tempat di seluruh sistem yang
      akan memperlihatkannya
- [ ] **Uang Saku tetap 0** sementara catatannya menyebut Rp103.985.000.
      Parser mereproduksi apa yang klien laporkan, dan menampilkan selisihnya.
      Kalau angkanya masuk ke kolom nominal, parser sudah memilih kebijakan
      akuntansi yang belum diputuskan (A-2, invarian 8)
- [ ] Angka Juli **berubah** dari 235.000.000 jadi 235.416.417 — periode ILJ
      karangan dari `seed.sql` memang dihapus dan diganti oleh file impor

Buka **ILJ Maret 2025**:

- [ ] Pendapatan **64.935.040** — sudah termasuk Rp4.935.040 dari invoice yang
      bertahun salah. Kalau nilainya 60.000.000, transaksi itu terlempar ke
      Maret 2024 dan hilang dari laporan

Buka **ILJ Januari 2025**:

- [ ] Pendapatan **50.000.000** — kedua baris `017B/JANUARI` terjumlah

Cek juga Dasbor Eksekutif (`/`):

- [ ] Pemilih periode kini berisi **enam** bulan
- [ ] Pilih **November 2024** — kartu Pendapatan Konsolidasi berbunyi
      *Tidak ada pembanding untuk Oktober 2024*. Itu bulan pertama; tidak ada
      yang bisa dibandingkan
- [ ] Pilih **Desember 2024** — perbandingan MoM-nya terisi

Dasbor memang tidak punya kolom YoY sama sekali; yang punya adalah layar P&L,
dan di sana ia tetap kosong (`A.3`).

### Bersihkan

```sh
rm latihan-ilj.xlsx supabase/seed-latihan.sql
npm run db:reset
```

- [ ] ILJ kembali ke 2 periode

## D.2 Impor yang sebenarnya

Begitu `Presentasi_Rekap_Income_Full_ILJ__Revisi_FIX.xlsx` ada:

```sh
npx tsx scripts/import-ilj.ts <path-ke-xlsx>
```

- [ ] `Periode diproses : 9`, November 2024 sampai Juli 2025
- [ ] `Verifikasi laba bersih: 9/9 cocok`
- [ ] Juli 2025 = **−2.178.807**
- [ ] Pendapatan Juli = **235.416.417**, bukan 470.832.834
- [ ] Baris 362 muncul di daftar "Invoice dilewati"
- [ ] Baris 207 (`06/ILJ/MARET/2024`) muncul di "Tahun invoice janggal"
- [ ] `044/ILJ/JULI-2025` muncul di "Sel #N/A jadi nol"
- [ ] **Lima** nomor invoice ganda terdaftar dan seluruhnya terjumlah
- [ ] `Label opex tak dikenal: 0` — kalau tidak nol, petakan dulu labelnya di
      `OPEX_RULES`, jangan diteruskan

> Parser **menolak menulis file** kalau verifikasi laba bersih meleset lebih
> dari Rp1. Kalau itu terjadi, yang salah parsernya — jangan sesuaikan angka
> supaya cocok.

Baca `supabase/seed-ilj.sql` sebelum menerapkannya. Itulah alasan script ini
menulis file alih-alih menulis ke database.

```sh
npm run db:reset
psql_f < supabase/seed-ilj.sql
npm test
```

Lalu di layar:

- [ ] `/entities`: ILJ **9 periode tercatat**
- [ ] Kesembilan periode bisa dibuka dan menampilkan angka
- [ ] Kolom MoM terisi di 8 periode, kosong di November 2024
- [ ] Kolom YoY kosong di seluruh periode — rentangnya belum 12 bulan
- [ ] Rekanan sekitar 83% dari tagihan di setiap periode (kolom Kontribusi
      pada baris `Bagian Rekanan`)
- [ ] Catatan uang saku terlihat di periode yang memang mencatatnya

Setelah data asli masuk, `supabase/seed.sql` sebaiknya dipangkas: periode ILJ
karangannya sudah tidak diperlukan, dan dua sumber angka ILJ di satu repo
adalah satu sumber terlalu banyak.

---

## Kalau ada yang tidak cocok

| Gejala | Kemungkinan besar |
|---|---|
| ILJ punya 4 periode, laba bersih Januari 2026 | Fixture kotor sisa `npm test`. Jalankan `npm run db:reset` |
| Semua angka meleset sedikit | Bukan fixture bersih. `npm run db:reset` |
| Beban yang naik tampil hijau | Pembalikan warna per section rusak — cek `deltaClass()` di `+page.svelte` |
| Kolom pembanding berisi `0` alih-alih `—` | Tidak ada data diperlakukan sebagai nol. Itu bug |
| Subtotal beda dengan `v_period_pnl` | Layar menghitung ulang subtotal. Melanggar invarian 2 |
| Chip basis abu-abu, bukan amber | Sistem diam-diam memilih basis pelaporan. Melanggar invarian 8 |
| Entitas lain terbuka bagi staf ILJ | **Berhenti.** Kebocoran RLS lintas entitas |
