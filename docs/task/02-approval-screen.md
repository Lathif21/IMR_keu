# Fase 1 · Tugas 2 — Layar Persetujuan

Kerjakan setelah Tugas 1. Layar ini memindahkan periode melewati alur status;
tanpa layar input, tidak ada yang bisa disetujui.

Baca dulu: `CLAUDE.md`, `src/lib/roles.ts`, dan bagian
`guard_period_transition` di `supabase/migrations/`.

## Rute

```
src/routes/(app)/approval/+page.server.ts
src/routes/(app)/approval/+page.svelte
```

Satu halaman. Panel review muncul sebagai baris yang bisa dibuka, bukan rute
terpisah — pengulas berpindah antar entitas berulang kali dan navigasi halaman
akan memperlambatnya.

## Akses

`canApprove()` — `direksi` dan `manajer_keuangan`. Selain itu redirect ke `/`.

`canUnlockPeriod()` — hanya `direksi`.

Keduanya untuk membentuk UI. Trigger yang menegakkan; jangan andalkan cek ini.

## Muat

Periode dipilih lewat `?periode=YYYY-MM`, default periode terbaru di
`v_period_completeness`.

Muat paralel:

1. Seluruh `entities` aktif
2. `periods` untuk bulan itu, semua entitas
3. `v_period_pnl` untuk bulan itu
4. `v_period_pnl` untuk bulan sebelumnya (`previousPeriod()`) — pembanding
5. `profiles` untuk menampilkan nama pengaju, bukan UUID

Entitas tanpa baris `periods` tetap ditampilkan, berstatus "Belum dibuat".
Entitas yang hilang harus terlihat hilang.

## Tabel antrean

| Kolom | Isi |
|---|---|
| Entitas | `legal_name`, dengan titik warna `theme_color` |
| Periode | `formatPeriod()` |
| Status | Badge |
| Diajukan oleh | Nama, dari `profiles` |
| Tanggal | `submitted_at` |
| Aksi | Sesuai status, lihat di bawah |

Warna badge mengikuti `statusConfig` di
`design/figma-export/app/App.tsx` (`ApprovalScreen`).

Urutan: `submitted` di atas — itu yang butuh tindakan. Lalu `draft`,
`approved`, `locked`.

## Panel review

Terbuka saat baris diklik. Isinya perbandingan bulan ini vs bulan lalu, ambil
dari `v_period_pnl` — jangan hitung ulang di klien (invarian 2).

Baris: Pendapatan · Beban Pokok · Laba Kotor · Beban Usaha · Laba Bersih ·
Margin Bersih. Kolom: bulan ini · bulan lalu · Δ%.

Δ adalah **month-over-month**. Beri label MoM. Prototipe menyebutnya YoY dan
itu salah.

Di header panel, tampilkan chip basis pelaporan entitas:

```
Basis: Kas · Penyajian: Bruto
```

Pakai `REPORTING_BASIS_LABEL` dan `REVENUE_PRESENTATION_LABEL`. Bila salah
satu `unknown`, chip berwarna amber dengan teks "belum ditetapkan" — pengulas
harus tahu ia sedang menyetujui angka yang basisnya belum disepakati.

## Aksi

### `approve`

```ts
.update({ status: 'approved', approved_by: user.id, approved_at: new Date() })
```

`guard_period_transition` menolak bila `approved_by = submitted_by`.
Sembunyikan tombolnya bila pengguna adalah pengaju — tapi tetap tangani
errornya, karena tombol tersembunyi bukan penegakan.

Pesan errornya sudah berbahasa Indonesia dan bisa ditampilkan apa adanya.

### `reject`

```ts
.update({ status: 'draft', rejection_note: note })
```

Catatan wajib — trigger menolak yang kosong. Validasi juga di klien supaya
pengguna tahu sebelum mengirim, tapi jangan hilangkan penanganan error.

Catatan penolakan harus tampil di layar input agar staf tahu apa yang salah.
Kalau `/entry/[period]` belum menampilkannya, tambahkan sekarang — banner
merah di atas form saat `rejection_note` terisi dan status `draft`.

### `lock`

```ts
.update({ status: 'locked', locked_by: user.id, locked_at: new Date() })
```

Hanya dari `approved`. Minta konfirmasi: setelah terkunci, hanya direksi yang
bisa membuka.

### `unlock`

`locked → draft`, hanya `direksi`. Tampilkan peringatan bahwa tindakan ini
tercatat di audit log dan mengeluarkan periode dari konsolidasi.

Sembunyikan tombol untuk peran lain.

## Banner kelengkapan

Di atas tabel, dari `v_period_completeness`:

```
3 dari 4 entitas sudah disetujui — PT X belum melapor
```

Amber bila belum lengkap, hijau bila lengkap. Sama seperti di dasbor.

## Sidebar

Ubah `href: null` → `href: '/approval'` untuk "Persetujuan".
Setelah tugas ini, hanya "Laporan P&L" yang tersisa disabled.

## Selesai bila

- [ ] `npm run check` bersih
- [ ] Manajer melihat keempat entitas, termasuk yang belum membuat periode
- [ ] Setujui memindahkan `submitted → approved`
- [ ] Tolak tanpa catatan ditolak, dengan catatan berhasil dan kembali ke draft
- [ ] Catatan penolakan terlihat oleh staf di layar input
- [ ] Pengaju tidak bisa menyetujui laporannya sendiri
- [ ] Kunci hanya dari `approved`; buka kunci hanya oleh direksi
- [ ] Periode terkunci menolak perubahan baris dari layar input
- [ ] Staf entitas yang membuka `/approval` diarahkan ke `/`
- [ ] Auditor bisa melihat, tidak bisa mengubah apa pun
- [ ] Setiap transisi menghasilkan baris `audit_log` dengan `actor_id` terisi
- [ ] Entitas yang disetujui masuk ke angka konsolidasi di dasbor

Verifikasi manual: `TESTING.md` Bagian 3, 5, dan 6.

## Ditunda

| Hal | Alasan |
|---|---|
| Notifikasi WhatsApp | Fase 4. Dasbor sudah punya tombol "Tegur Admin" berupa tautan `wa.me` |
| Persetujuan massal | Empat entitas. Satu per satu masih wajar |
| Riwayat penolakan | Hanya catatan terakhir yang disimpan. Riwayat lengkap ada di `audit_log`; buat layarnya kalau memang dibutuhkan |
| Penanganan konflik dua pengulas bersamaan | `TESTING.md` mencatat ini belum diuji. Empat entitas, satu manajer — belum jadi masalah nyata |
