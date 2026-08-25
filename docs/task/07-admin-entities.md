# Fase 3 · Tugas 7 — Layar Entitas

Layar admin pertama. Tanpa entitas, tidak ada apa pun di sistem ini.

Kerjakan setelah Tugas 6 — bergantung pada RPC `set_entity_reporting_basis()`.

## Rute

```
src/routes/(app)/admin/+layout.server.ts        guard direksi
src/routes/(app)/admin/entities/+page.server.ts
src/routes/(app)/admin/entities/+page.svelte
```

`+layout.server.ts` menolak selain `direksi` dengan redirect ke `/`. Semua
layar admin berikutnya menumpang guard ini.

Tambahkan "Administrasi" ke `Sidebar.svelte`, `visible: role === 'direksi'`.

## Daftar

Satu tabel, entitas aktif di atas, nonaktif di bawah dengan opasitas turun.

| Kolom | Isi |
|---|---|
| Kode | `code`, dengan titik `theme_color` |
| Nama | `legal_name` |
| NPWP | `npwp`, atau `NO_DATA` |
| Lini usaha | `business_line` |
| Basis | Chip `REPORTING_BASIS_LABEL` + `REVENUE_PRESENTATION_LABEL` |
| Periode | Jumlah periode berstatus `approved`/`locked` |
| Status | Aktif / Nonaktif |

Chip basis berwarna amber bila salah satunya `unknown`. Ini kondisi normal
saat ini — A-1 dan A-5 belum terjawab — jadi jangan tampilkan seperti error.

Baris entitas yang lini usahanya belum punya template aktif diberi peringatan:
*"Lini usaha ini belum punya template — entitas tidak dapat membuat periode."*
Tautkan ke `/admin/templates`.

## Buat entitas

| Field | Aturan |
|---|---|
| `code` | Wajib, unik, huruf besar, ≤10 karakter |
| `legal_name` | Wajib |
| `npwp` | Opsional, unik bila diisi |
| `business_line` | Wajib, pilihan bebas — bukan enum di database |
| `icon_key` | Pilihan dari `src/lib/icons.ts` |
| `theme_color` | Pilihan dari `--color-line-1..4` di `app.css` |

`code` dan `npwp` unik ditegakkan database. Kirim saja, tangkap `23505`, dan
tampilkan pesan yang menyebut field mana yang bentrok.

Entitas baru selalu lahir `reporting_basis = 'unknown'` dan
`revenue_presentation = 'unknown'`. **Jangan sediakan field ini di form
pembuatan** — menetapkannya butuh alasan tertulis, dan orang yang sedang
membuat entitas belum tentu tahu jawabannya. Itu keputusan terpisah.

`business_line` bebas teks, tapi tawarkan nilai yang sudah ada sebagai
datalist. Salah ketik di sini memutus pencocokan ke template.

## Ubah entitas

Field yang sama, ditambah:

- `ownership_pct` — default 100, 0–100
- `fiscal_year_start_month` — default 1

`code` boleh diubah, tapi peringatkan bahwa ia muncul di laporan yang sudah
diekspor.

## Menetapkan basis pelaporan

Dialog terpisah, bukan bagian dari form ubah. Ini yang membedakannya dari
field biasa.

Isi dialog:

1. Penjelasan singkat konsekuensinya — mengubah basis mengubah arti seluruh
   laporan entitas ini, dan bagaimana ia dibandingkan dengan entitas lain
2. `reporting_basis`: Kas / Akrual
3. `revenue_presentation`: Bruto / Neto
4. `effective_from` — periode mulai berlaku
5. `rationale` — wajib, textarea, minimal kalimat utuh

Panggil RPC:

```ts
await supabase.rpc('set_entity_reporting_basis', {
  p_entity_id: id,
  p_basis: basis,
  p_presentation: presentation,
  p_rationale: rationale,
  p_effective_from: effectiveFrom
});
```

Jangan pernah update kolomnya langsung — trigger akan menolak, dan itu memang
tujuannya.

Di bawah dialog, tampilkan riwayat penetapan sebelumnya dari
`accounting_policies` (`policy_key in ('reporting_basis','revenue_presentation')`,
`entity_id` cocok), urut `effective_from` menurun. Direksi berikutnya perlu
melihat alasan yang dipakai pendahulunya.

Kalau `p_effective_from` mundur ke belakang melewati periode yang sudah
`locked`, tampilkan peringatan bahwa laporan yang sudah dikunci tidak ikut
disajikan ulang. Jangan blokir — hanya beri tahu.

## Nonaktifkan

Toggle `is_active`. **Tidak ada tombol hapus di mana pun.**

Alasannya bukan kehati-hatian belaka: `periods.entity_id` memakai
`on delete restrict`, jadi entitas yang pernah melapor memang tidak bisa
dihapus. Menyediakan tombol yang selalu gagal lebih buruk daripada tidak
menyediakannya.

Konfirmasi menjelaskan apa yang terjadi: entitas hilang dari layar input dan
dari entitas yang diharapkan melapor, tetapi laporan historisnya tetap utuh
dan tetap masuk konsolidasi periode lampau.

Entitas nonaktif bisa diaktifkan kembali.

## Penanganan error

Ikuti `failLoad()` dan `explain()` yang sudah dipakai di
`src/routes/(app)/entry/`. Pesan dari `raise exception` kita sendiri
(`code === 'P0001'`) sudah berbahasa Indonesia — tampilkan apa adanya.

## Selesai bila

- [ ] `npm run check` bersih
- [ ] Non-direksi yang membuka `/admin/entities` diarahkan ke `/`
- [ ] Entitas baru bisa dibuat dan langsung muncul di `/entry` bagi staf yang
      ditautkan
- [ ] `code` atau `npwp` ganda ditolak dengan pesan yang menyebut field-nya
- [ ] Entitas baru berbasis `unknown`, dan chip-nya amber
- [ ] Dialog basis menolak alasan kosong
- [ ] Menetapkan basis menghasilkan dua baris `accounting_policies` dan
      memperbarui `entities`
- [ ] Riwayat penetapan tampil dengan alasan dan nama pemutus
- [ ] Entitas di lini tanpa template menampilkan peringatan
- [ ] Nonaktifkan menyembunyikan entitas dari `/entry` tanpa mengubah laporan
      historis di `/entities`
- [ ] Tidak ada tombol hapus di layar ini

## Ditunda

| | Alasan |
|---|---|
| Unggah logo entitas | Butuh storage; `icon_key` + warna sudah cukup |
| Struktur induk-anak entitas | Satu tingkat, empat entitas |
| Kepemilikan non-pengendali di laporan | `ownership_pct` disimpan tapi belum dipakai view mana pun. Butuh A-6 |
