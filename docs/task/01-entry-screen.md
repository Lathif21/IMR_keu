# Fase 1 · Tugas 1 — Layar Input Laporan

Jalur tulis pertama sistem. Sampai layar ini ada, satu-satunya cara memasukkan
laporan adalah SQL langsung.

Baca dulu: `CLAUDE.md` (invarian), `CONTEXT.md` (kosakata), `src/lib/roles.ts`.

## Prasyarat

```sh
npm run db:types && git add src/lib/server/database.types.ts
```

Ini melengkapi `domain.ts`, tidak menggantikannya. `domain.ts` sengaja ditulis
tangan sebagai subset stabil — biarkan apa adanya.

## Rute

```
src/routes/(app)/entry/+page.server.ts        daftar periode entitas
src/routes/(app)/entry/+page.svelte
src/routes/(app)/entry/[period]/+page.server.ts   form
src/routes/(app)/entry/[period]/+page.svelte
```

`[period]` berformat `YYYY-MM` di URL, disimpan sebagai `YYYY-MM-01`.

## Menentukan entitas

Hanya `staf_entitas` yang mengisi laporan (`canEnterReports`). Entitasnya
berasal dari `user_entity_access`, bukan dari URL — staf tidak boleh memilih
entitas lain.

- 0 entitas → tampilkan pesan "Akun Anda belum ditautkan ke entitas mana pun.
  Hubungi direksi." Jangan 500.
- 1 entitas → pakai itu.
- >1 entitas → pemilih di header, default entitas pertama menurut `code`.

Jangan pernah membaca `entity_id` dari query param tanpa memverifikasinya ada
di daftar akses. RLS akan menolak, tapi pesan errornya buruk.

## Halaman daftar (`/entry`)

Baris per periode milik entitas tersebut, terbaru di atas:

| Kolom | Isi |
|---|---|
| Periode | `formatPeriod()` → "Juli 2025" |
| Status | Badge, `PERIOD_STATUS_LABEL` |
| Terakhir diubah | `updated_at` |
| Aksi | "Isi" bila `draft`, "Lihat" bila selain itu |

Di atas daftar: tombol **"Buat Periode Baru"**. Bulan default adalah bulan
berikutnya setelah periode terakhir; kalau belum ada periode sama sekali,
bulan berjalan.

Pembuatan periode butuh `template_id`. Ambil dari `report_templates` dengan
`business_line` sama dengan entitas, `is_active = true`, `version` tertinggi.
Kalau tidak ketemu, tolak dengan pesan "Belum ada template laporan untuk lini
usaha ini" — jangan buat periode tanpa template, karena
`guard_line_code_in_template` akan menolak setiap baris setelahnya.

Status hasil insert **selalu** `draft`; `guard_period_insert` memaksa itu dan
menimpa kolom jejak alur kerja. Jangan kirim `status`, `submitted_by`, atau
`created_by` dari klien.

## Form (`/entry/[period]`)

### Muat

1. `periods` untuk `(entity_id, period)`. Tidak ada → 404.
2. `report_template_lines` untuk `periods.template_id`, `is_active = true`,
   urut `sort_order`.
3. `report_lines` untuk `period_id` — peta `line_code` → `amount`, `note`.

Baris yang belum ada di `report_lines` tampil dengan nilai 0. Jangan insert
baris kosong saat memuat.

### Tabel

Ikuti `design/figma-export/app/App.tsx` (`EntryScreen`), tapi pakai token dari
`src/app.css`, bukan hex mentah.

Bagian dikelompokkan per `section` dengan urutan tetap:

```
revenue → cogs → opex → other_income → other_expense → tax
```

Judul bagian pakai label Indonesia: Pendapatan, Beban Pokok Pendapatan,
Beban Usaha, Pendapatan Lain-lain, Beban Lain-lain, Pajak Penghasilan.

Kolom: Nama Pos · Jumlah (Rp) · Catatan.

**Jangan tampilkan kolom "Kode Akun".** Desain Figma menampilkannya (`4-001`,
`5-001`), tapi bagan akun belum ditetapkan — lihat `ASSUMPTIONS.md` A-7.
Menampilkan kode yang akan berubah membuat pengguna terbiasa pada sesuatu
yang salah.

### Baris subtotal

Disisipkan **sebagai tampilan saja**, dihitung dari nilai di layar. Ikon
gembok, latar `--color-card`, tidak bisa difokus.

Subtotal tidak pernah disimpan dan tidak pernah dikirim ke server
(invarian 2). Server tidak memakainya sama sekali — `v_period_pnl` menghitung
ulang dari baris input.

### Input angka

- Rupiah penuh. Tidak ada "juta", tidak ada "miliar" (invarian 3).
- Saat fokus: nilai mentah, mudah diedit.
- Saat blur: `formatAmount()` → `1.500.000`.
- Parsing: buang semua non-digit kecuali tanda minus di depan. Input Indonesia
  kadang memuat `.` sebagai pemisah ribuan dan `,` sebagai desimal — keduanya
  dibuang, karena nominal di sini selalu bulat.
- Kosong = 0, bukan null.
- `Tab` dan `Enter` berpindah ke input jumlah berikutnya, melewati baris
  subtotal. Staf keuangan datang dari Excel; navigasi keyboard menentukan
  apakah mereka bertahan atau kembali ke spreadsheet.

### Baris dengan peringatan

Baris yang `help_text`-nya terisi menampilkan ikon segitiga amber dan teks
bantuannya di bawah label. `COGS_SAKU` sudah punya ini di seed —
*"Isi 0 bila diperlakukan sebagai uang muka"* — karena A-2 belum diputuskan.

Peringatan tidak memblokir submit. Ini menampilkan lubang, bukan menutupnya.

### Footer sticky

Selalu terlihat, memuat: Total Pendapatan · Total Beban · Laba Bersih ·
tombol Simpan Draft · tombol Ajukan.

Laba bersih negatif tampil dalam kurung dan warna `--color-destructive`:
`(Rp 2.178.807)`.

## Aksi

### `saveDraft`

Upsert seluruh baris yang nilainya bukan 0 atau catatannya terisi:

```ts
.from('report_lines')
.upsert(rows, { onConflict: 'period_id,line_code' })
```

Baris yang jadi 0 **dan** tanpa catatan: hapus. Menyimpan nol di mana-mana
membuat tabel penuh baris tak bermakna.

`guard_period_editable` menolak kalau periode bukan `draft`. Jangan cek status
di JavaScript sebelum menulis — kirim, biarkan database menolak, tampilkan
pesannya (`roles.ts` menyatakan ini eksplisit).

### `submit`

Simpan draft dulu, lalu:

```ts
.from('periods')
.update({ status: 'submitted', submitted_by: user.id, submitted_at: new Date() })
.eq('id', periodId)
```

`submitted_by` **wajib** diisi di update yang sama — `guard_period_transition`
memakainya untuk menegakkan pemisahan tugas saat approval nanti.

Sebelum submit, minta konfirmasi bila seluruh baris bernilai 0. Itu hampir
pasti kesalahan, tapi bukan hal yang mustahil, jadi konfirmasi — bukan blokir.

Berhasil → redirect ke `/entry` dengan pesan sukses.

## Penanganan error

Pesan Postgres menyebut nama tabel, kolom, dan policy. Ikuti pola `fail()` di
`src/routes/(app)/+page.server.ts`: log lengkap ke server, kirim kalimat tetap
ke browser.

Pengecualian: pesan dari trigger `raise exception` kita sendiri sudah ditulis
untuk pengguna dan berbahasa Indonesia. Tampilkan apa adanya. Kenali lewat
`code === 'P0001'`.

## Sidebar

Di `src/lib/components/Sidebar.svelte`, ubah `href: null` menjadi
`href: '/entry'` untuk "Input Laporan". Biarkan dua lainnya disabled.

## Selesai bila

- [ ] `npm run check` bersih
- [ ] Staf ILJ bisa membuat periode baru, mengisi, menyimpan draft, mengajukan
- [ ] Draft yang disimpan muncul utuh setelah reload
- [ ] Periode `submitted` tampil read-only, tanpa tombol simpan
- [ ] Subtotal berubah langsung saat mengetik, tanpa menunggu simpan
- [ ] `line_code` palsu ditolak dengan pesan Indonesia yang bisa dibaca
- [ ] Staf ILJ tidak bisa membuka `/entry` entitas lain
- [ ] Angka disimpan sebagai rupiah penuh — cek langsung di `report_lines`
- [ ] `audit_log` memuat baris untuk setiap perubahan, dengan `actor_id` terisi

Verifikasi manual: `TESTING.md` Bagian 3 dan 5, dijalankan ulang setelah
`npm run db:reset`.

## Ditunda, jangan dikerjakan sekarang

| Hal | Alasan |
|---|---|
| Autosave tiap 30 detik | Tombol simpan eksplisit dulu. Autosave di atas periode yang bisa berubah status butuh penanganan konflik yang belum ada kasusnya. |
| Import CSV | Fase 4 |
| Prefill kode akun periode sebelumnya | Template sudah menyediakan seluruh baris; tidak ada yang perlu diprefill |
| Kolom Kode Akun | A-7 belum diputuskan |
