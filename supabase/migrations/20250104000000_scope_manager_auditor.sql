-- =====================================================================
--  MANAJER DAN AUDITOR MENJADI BER-SCOPE PER ENTITAS
--
--  Sampai migrasi ini, can_read_all_entities() bernilai true untuk
--  direksi, manajer_keuangan, DAN auditor. Artinya has_entity_access()
--  mengembalikan true untuk ketiganya tanpa pernah menyentuh
--  user_entity_access, sehingga penugasan entitas hanya berarti bagi
--  staf_entitas.
--
--  Keputusan baru: hanya direksi yang melihat seluruh entitas. Manajer
--  dan auditor ditugaskan per entitas persis seperti staf, lewat
--  user_entity_access. Administrasi tetap direksi saja — semua policy
--  master data sudah menguji current_user_role() = 'direksi' secara
--  langsung, jadi tidak ada satu pun yang ikut bergeser di sini.
--
--  Satu fungsi memikul dua arti yang berbeda sebelum ini:
--
--    (a) "boleh melihat SETIAP entitas"     — cakupan baris per entitas
--    (b) "boleh melihat data tingkat grup"  — profiles, intercompany,
--                                             audit_log; tabel yang tidak
--                                             punya entity_id sama sekali
--
--  Mempersempit (a) tanpa memisahkan (b) akan mencabut hal-hal yang tidak
--  ada hubungannya dengan cakupan entitas. Yang paling parah:
--  ic_manage memberi manajer hak TULIS intercompany lewat can_approve(),
--  sementara ic_select memberi hak BACA lewat can_read_all_entities() —
--  mempersempit yang kedua saja menghasilkan peran yang menulis baris
--  yang tidak bisa ia baca kembali. Maka (b) dipindah ke fungsi sendiri.
--
--  Migrasi maju-saja. Fungsi didefinisikan ulang; hanya tiga policy yang
--  disentuh, yaitu tepat tiga policy yang memaksudkan (b).
-- =====================================================================


-- --- 1. Cakupan entitas: direksi saja ----------------------------------

create or replace function can_read_all_entities()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() = 'direksi', false);
$$;

comment on function can_read_all_entities() is
  'True hanya untuk direksi. Peran lain — termasuk manajer_keuangan dan '
  'auditor — melihat entitas lewat user_entity_access. Untuk hak baca data '
  'tingkat grup yang tidak punya entity_id, pakai can_read_group_data().';


-- --- 2. Data tingkat grup: direksi, manajer, auditor -------------------
--
--  Sengaja BUKAN "bukan staf_entitas". Peran baru harus dinyatakan
--  masuk secara eksplisit; sebuah daftar-hitam akan memberi peran yang
--  belum ada itu hak baca audit_log tanpa ada yang memutuskannya.

create or replace function can_read_group_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() in ('direksi', 'manajer_keuangan', 'auditor'), false);
$$;

comment on function can_read_group_data() is
  'Boleh membaca tabel tingkat grup yang tidak punya entity_id: profiles, '
  'intercompany_transactions, audit_log. Bukan izin melihat seluruh entitas — '
  'itu can_read_all_entities().';


-- --- 3. Policy yang memaksudkan "tingkat grup", bukan "semua entitas" --

-- Nama pengaju di layar Persetujuan datang dari sini. Tanpa ini seorang
-- manajer hanya melihat profilnya sendiri, dan antrean persetujuan
-- kehilangan nama setiap orang yang mengajukan.
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or can_read_group_data());

-- Pasangan baca untuk ic_manage, yang tetap can_approve().
drop policy if exists ic_select on intercompany_transactions;
create policy ic_select on intercompany_transactions for select to authenticated
  using (can_read_group_data());

-- Membaca jejak audit adalah pekerjaan auditor. Mempersempitnya ke
-- direksi akan mencabut satu-satunya hal yang membuat peran itu ada.
drop policy if exists audit_select on audit_log;
create policy audit_select on audit_log for select to authenticated
  using (can_read_group_data());

-- uea_select sengaja TIDAK diubah: setelah fungsi di atas dipersempit,
-- ia berarti "baris sendiri, atau direksi". Satu-satunya layar yang
-- membaca daftar penugasan orang lain adalah /admin/users, dan layar itu
-- direksi saja.


-- --- 4. Backfill --------------------------------------------------------
--
--  Setiap manajer dan auditor yang ada hari ini melihat semua entitas
--  lewat fungsi lama dan karenanya tidak punya satu pun baris
--  user_entity_access. Tanpa backfill, migrasi ini akan mencabut seluruh
--  akses mereka pada saat deploy — bukan pengetatan yang diputuskan,
--  melainkan pemadaman.
--
--  Jadi mereka mendarat pada akses yang sama persis dengan sebelumnya,
--  dan direksi mencabut yang tidak perlu lewat layar Pengguna. Hanya
--  entitas aktif: entitas nonaktif tidak diharapkan melapor, dan
--  menautkannya berarti menghidupkan kembali penugasan yang sudah usai.
--
--  granted_by dibiarkan NULL — tidak ada manusia yang memberikan ini.
--  on conflict do nothing membuat migrasi aman dijalankan ulang.

insert into user_entity_access (user_id, entity_id, granted_by)
select p.id, e.id, null
from profiles p
cross join entities e
where p.role in ('manajer_keuangan', 'auditor')
  and p.is_active
  and e.is_active
on conflict (user_id, entity_id) do nothing;


-- --- 5. Komentar tabel yang kini keliru --------------------------------

comment on table user_entity_access is
  'Penugasan entitas untuk setiap peran KECUALI direksi: staf_entitas, '
  'manajer_keuangan, dan auditor. Direksi melihat seluruh entitas lewat '
  'can_read_all_entities() dan tidak butuh baris di sini.';
