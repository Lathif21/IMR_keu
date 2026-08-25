# Fase 3 · Tugas 9 — Layar Pengguna

Peran dan akses entitas dalam satu layar. Keduanya menempel pada orang yang
sama; memisahkannya berarti memelihara dua daftar yang isinya identik.

Kerjakan setelah Tugas 6 — bergantung pada trigger audit `profiles`.

## Peringatan keamanan

Layar ini satu-satunya tempat di seluruh aplikasi yang memakai **service role
key**. Key itu melewati RLS sepenuhnya.

Aturan mutlak:

- Key hanya dibaca di `+page.server.ts`, tidak pernah di `.svelte`
- Namanya **tanpa** awalan `PUBLIC_` — SvelteKit akan menolak menyertakan
  `$env/static/private` ke bundel klien, dan itu memang lapisan pengaman
  terakhirnya
- Klien service role dibuat per-request di dalam action, tidak pernah sebagai
  singleton modul
- Jangan pernah mengembalikan objek user mentah dari Supabase ke klien; ambil
  hanya field yang dipakai

```
# .env
SUPABASE_SERVICE_ROLE_KEY="..."
```

Tambahkan ke `.env.example` dengan nilai kosong dan komentar.

## Rute

```
src/routes/(app)/admin/users/+page.server.ts
src/routes/(app)/admin/users/+page.svelte
```

Guard direksi diwarisi dari `admin/+layout.server.ts` (Tugas 7).

## Daftar

| Kolom | Isi |
|---|---|
| Nama | `full_name` |
| Email | Dari `auth.users`, lewat `auth.admin.listUsers()` |
| Peran | Badge |
| Entitas | Chip nama entitas, atau "Semua" untuk peran non-staf |
| Telepon | `phone` |
| Status | Aktif / Nonaktif |

Kolom Entitas hanya bermakna untuk `staf_entitas`. Peran lain membaca seluruh
entitas lewat `can_read_all_entities()`; tampilkan "Semua", bukan daftar kosong.

Pengguna nonaktif di bawah, opasitas turun.

## Buat pengguna

Server action. Dua langkah dalam satu alur:

```ts
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true
});
```

`email_confirm: true` melewati verifikasi email — tidak ada SMTP terkonfigurasi,
dan tanpa ini akun tidak bisa login.

Lalu insert `profiles` dengan `id` dari `data.user.id`. **Kedua langkah harus
berhasil bersama.** Kalau insert profil gagal, hapus user auth yang baru dibuat
— akun auth tanpa profil menghasilkan `current_user_role()` null dan pengguna
melihat aplikasi kosong tanpa penjelasan.

Field form: email, password, `full_name`, `role`, `phone`, dan entitas bila
peran `staf_entitas`.

### Soal password

Keputusan: admin menetapkan password langsung.

Konsekuensinya password melewati tangan admin. Untuk sepuluh orang dalam satu
grup ini dapat diterima, tapi perlakukan sebagai keputusan sadar:

- Minimal 8 karakter, ditolak di server bukan hanya di klien
- **Jangan pernah** menuliskannya ke log, ke `audit_log`, atau ke pesan error
- Jangan kirim balik ke klien setelah dibuat
- Sediakan tombol "acak" yang membuat password kuat dan menampilkannya sekali
  di layar untuk disalin admin

Catat batasan ini di `README.md` bagian keamanan: tidak ada verifikasi email,
tidak ada reset mandiri, admin mengetahui password awal.

## Ubah pengguna

`full_name`, `role`, `phone` — update `profiles` biasa, lewat RLS, tanpa
service role.

Email tidak dapat diubah. `auth.admin.updateUserById()` bisa melakukannya, tapi
mengubah email seseorang tanpa verifikasi adalah cara mengambil alih akun.
Kalau memang perlu, nonaktifkan dan buat yang baru.

### Mengubah peran

Konfirmasi yang menjelaskan akibatnya, bukan sekadar "Anda yakin?":

- Menjadi `staf_entitas` → kehilangan akses ke entitas lain, harus ditautkan
- Menjadi `direksi` → dapat membuka periode terkunci dan mengelola seluruh
  administrasi
- Meninggalkan `staf_entitas` → baris `user_entity_access` menjadi tidak
  relevan. Biarkan; kalau perannya dikembalikan, tautannya masih ada

Perubahan peran teraudit sejak Tugas 6.

## Akses entitas

Hanya muncul bila peran `staf_entitas`.

Daftar centang entitas aktif. Menyimpan berarti insert dan delete pada
`user_entity_access`. `granted_by` diisi `auth.uid()`, jangan dari klien.

Satu staf boleh memegang lebih dari satu entitas — `/entry` sudah menangani
pemilihnya.

Staf tanpa satu pun entitas melihat pesan yang sudah ada di `/entry`:
*"Akun Anda belum ditautkan ke entitas mana pun."* Layar ini yang
memperbaikinya, jadi tampilkan peringatan di daftar untuk staf yang belum
tertaut.

## Nonaktifkan

Toggle `profiles.is_active`. Tidak ada hapus — `audit_log.actor_id` menunjuk ke
pengguna, dan riwayat tanpa pelaku tidak ada gunanya.

`current_user_role()` sudah memfilter `is_active`, jadi pengguna nonaktif
kehilangan seluruh akses meski sesinya masih hidup. Verifikasi ini benar-benar
terjadi; kalau tidak, sesi lama akan tetap jalan sampai token kedaluwarsa.

Dua pengaman di sisi aplikasi:

- Tidak dapat menonaktifkan diri sendiri
- Tidak dapat menonaktifkan direksi terakhir yang aktif

Keduanya cek aplikasi, bukan trigger. Kesalahannya reversibel lewat SQL dan
pelakunya tercatat — belum sepadan dengan penegakan di database.

## Reset password

Server action, `auth.admin.updateUserById(id, { password })`. Aturan yang sama
dengan pembuatan: jangan dicatat, jangan dikirim balik.

## Selesai bila

- [ ] `npm run check` bersih
- [ ] Non-direksi diarahkan ke `/`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` tidak muncul di bundel klien — cek
      `.svelte-kit/output/client` setelah build
- [ ] Pengguna baru dapat login dengan password yang ditetapkan admin
- [ ] Insert profil gagal → user auth ikut dihapus, tidak ada akun yatim
- [ ] Staf yang ditautkan ke entitas langsung melihatnya di `/entry`
- [ ] Mencabut akses entitas menghilangkannya dari `/entry` staf tersebut
- [ ] Perubahan peran menghasilkan baris `audit_log`
- [ ] Pengguna nonaktif kehilangan akses meski sesinya masih ada
- [ ] Tidak dapat menonaktifkan diri sendiri atau direksi terakhir
- [ ] Password tidak muncul di log server mana pun

## Ditunda

| | Alasan |
|---|---|
| Undangan lewat email | Butuh SMTP. Sudah diputuskan: admin menetapkan password |
| Wajib ganti password saat login pertama | Sepuluh pengguna, satu grup. Tambahkan bila jumlahnya bertambah |
| Autentikasi dua faktor | Sama |
| Peran khusus per entitas | Peran bersifat global; belum ada kasus yang membutuhkan sebaliknya |
| Layar riwayat aktivitas pengguna | `audit_log` sudah lengkap. Buat layarnya bila memang dibuka orang |
