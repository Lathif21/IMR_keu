# Fase 3 · Tugas 8 — Layar Template Laporan

Layar admin paling rumit. Template menentukan pos apa saja yang dilaporkan
setiap entitas — salah di sini menghasilkan laporan yang salah bentuk tanpa
error apa pun.

Kerjakan setelah Tugas 6 — bergantung pada constraint `sort_order` yang sudah
deferrable.

## Kenapa ini memblokir

Membuat periode memerlukan template aktif untuk `business_line` entitas.
Sekarang hanya ada `TRUCKING_V1`. AMDK, tambang, dan garam belum punya apa pun,
jadi entitas di lini itu **tidak dapat membuat periode sama sekali** — layar
input menolak dengan "Belum ada template laporan untuk lini usaha ini".

## Rute

```
src/routes/(app)/admin/templates/+page.server.ts        daftar
src/routes/(app)/admin/templates/+page.svelte
src/routes/(app)/admin/templates/[id]/+page.server.ts   editor baris
src/routes/(app)/admin/templates/[id]/+page.svelte
```

## Daftar

Dikelompokkan per `business_line`. Per template: `code`, `name`, `version`,
jumlah baris aktif, status, dan jumlah periode yang memakainya.

Lini usaha yang ada di `entities` tapi belum punya template aktif ditampilkan
sebagai baris kosong dengan tombol "Buat Template" — kekurangan harus terlihat,
bukan tersembunyi.

## Aturan versi

Ini bagian terpenting di seluruh layar.

**Template yang sudah dipakai periode non-`draft` tidak dapat diubah.** Sistem
memaksa duplikat ke versi baru.

Alasannya: `v_period_pnl` menentukan `section` sebuah nominal lewat join ke
`report_template_lines`. Mengubah `section` sebuah baris memindahkan seluruh
nominal historis dari, misalnya, Beban Pokok ke Beban Usaha — di semua periode
yang pernah memakai template itu, termasuk yang sudah `locked`. Laba kotor
seluruh riwayat berubah, tanpa satu pun error.

Menambah baris baru sebenarnya aman. Tapi memilah mana yang aman dan mana yang
tidak menghasilkan aturan yang harus diingat orang. Melarang semua perubahan
lebih mudah dijelaskan dan tidak punya kasus tepi.

Cek pemakaian:

```sql
select count(*) from periods
where template_id = $1 and status <> 'draft'
```

Nol → boleh diubah langsung. Lebih dari nol → hanya bisa diduplikasi.

Tampilkan status ini di header editor: "Dipakai 9 periode — perubahan
memerlukan versi baru" atau "Belum dipakai — dapat diubah langsung".

### Duplikat ke versi baru

Salin template beserta seluruh barisnya, `version + 1`, `code` sama.
`unique (code, version)` sudah menjaga.

Setelah duplikat: versi baru `is_active = true`, versi lama
`is_active = false`. Periode lama tetap menunjuk `template_id` lama, jadi
laporannya tidak berubah — itu justru gunanya.

Periode baru mengambil template aktif dengan `version` tertinggi untuk lini
tersebut. Logika ini sudah ada di `/entry`; jangan tulis ulang.

## Editor baris

Tabel, dikelompokkan per `section` dengan urutan tetap:

```
revenue → cogs → opex → other_income → other_expense → tax
```

| Kolom | Aturan |
|---|---|
| `line_label` | Wajib. Teks Indonesia yang dilihat staf |
| `line_code` | Wajib, unik per template, `SECTION_NAMA` huruf besar |
| `section` | Enum `line_section` |
| `help_text` | Opsional. Tampil sebagai peringatan amber di layar input |
| Urutan | Tombol naik/turun |
| Aktif | Toggle |

`line_code` **tidak dapat diubah** setelah baris pernah dipakai di
`report_lines` mana pun. Mengubahnya memutus hubungan ke nominal yang sudah
tersimpan — nominalnya tetap ada, tapi `guard_line_code_in_template` membuatnya
tak terjangkau dan `v_period_pnl` kehilangan `section`-nya. Cek pemakaian
sebelum mengizinkan edit; kalau sudah dipakai, tampilkan `line_code` sebagai
teks mati.

### Menonaktifkan baris

Aman untuk histori. `v_period_pnl` join tanpa memfilter `is_active`, jadi
nominal periode lampau tetap terhitung.

Verifikasi `guard_line_code_in_template` — kalau ia memfilter `is_active`,
baris nonaktif akan menolak input baru sambil membiarkan histori utuh. Itu
perilaku yang benar; pastikan memang begitu dan catat di spesifikasi ini kalau
ternyata berbeda.

### Mengubah urutan

Tukar `sort_order` dua baris dalam satu transaksi. Constraint sudah
`deferrable initially deferred` sejak Tugas 6, jadi pelanggaran sementara
di tengah transaksi diperbolehkan.

Kalau ternyata masih ditolak, periksa dulu nama constraint yang di-drop di
Tugas 6 — jangan langsung beralih ke trik nilai negatif.

## Pratinjau

Panel di samping editor menampilkan bentuk layar input yang akan dilihat staf:
judul bagian, baris input, dan baris subtotal terkunci di posisinya.

Ini bukan hiasan. Struktur laporan sulit dinilai dari tabel konfigurasi, dan
kesalahan penempatan `section` baru terasa berbulan-bulan kemudian saat laba
kotor terlihat aneh.

Subtotal di pratinjau dihitung dari struktur, bukan dari nilai. Tidak ada
angka di pratinjau.

## Membuat template baru

Untuk lini usaha yang belum punya. Dua pilihan:

1. **Kosong** — tambahkan baris satu per satu
2. **Salin dari template lain** — mulai dari `TRUCKING_V1` lalu sesuaikan

Opsi 2 lebih sering dipakai; struktur beban usaha mirip antar lini, yang
berbeda hanya beban pokoknya.

Template baru wajib punya minimal satu baris `revenue` sebelum dapat
diaktifkan. Template tanpa pendapatan menghasilkan laporan yang seluruh
marginnya null.

## Catatan lini usaha

Tiga lini belum punya template. Pos beban pokoknya berbeda total dan
**belum divalidasi akuntan** — lihat Q9 di daftar pertanyaan akuntan.

Jangan mengarang struktur untuk AMDK, tambang, atau garam di layar ini. Yang
dibangun sekarang adalah alatnya; pengisiannya menunggu jawaban. Kalau perlu
template sementara untuk pengujian, tandai jelas di `name`, misalnya
"AMDK — Sementara, belum divalidasi".

## Selesai bila

- [ ] `npm run check` bersih
- [ ] Non-direksi diarahkan ke `/`
- [ ] Template baru bisa dibuat untuk lini tanpa template, dan entitas di lini
      itu langsung bisa membuat periode
- [ ] Template yang dipakai periode non-draft menolak perubahan langsung
- [ ] Duplikat menghasilkan `version + 1`, menonaktifkan versi lama
- [ ] Periode lama tetap membaca template lamanya — angka `/entities` tidak
      berubah setelah duplikat
- [ ] `line_code` yang sudah dipakai tampil sebagai teks mati
- [ ] Mengubah urutan dua baris berhasil dalam satu transaksi
- [ ] Menonaktifkan baris tidak mengubah laporan historis
- [ ] Pratinjau mencerminkan urutan bagian dan posisi subtotal dengan benar
- [ ] Setiap perubahan template menghasilkan baris `audit_log`

## Ditunda

| | Alasan |
|---|---|
| Rumus subtotal yang bisa dikonfigurasi | Subtotal diturunkan dari `section`. Rumus bebas berarti mesin ekspresi — jauh melampaui kebutuhan |
| Impor template dari CSV | Enam baris di form lebih cepat daripada menyiapkan CSV |
| Kolom `account_code` di editor | A-7 belum diputuskan. Kolomnya ada di database, biarkan kosong |
| Bagian bersarang lebih dari satu tingkat | `parent_line_code` tidak ada di schema. Tambahkan kalau memang dibutuhkan |
