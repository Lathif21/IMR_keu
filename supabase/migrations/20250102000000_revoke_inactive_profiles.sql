-- =====================================================================
--  Menonaktifkan profil harus benar-benar mencabut akses.
--
--  Ditemukan oleh tests/rls.test.ts saat Fase 2 Tugas 5.
--
--  has_entity_access() hanya membaca user_entity_access dan tidak pernah
--  melihat profiles.is_active. Akibatnya akun staf_entitas yang sudah
--  dinonaktifkan tetap dapat:
--
--    - membaca periods, report_lines, dan v_period_pnl entitasnya
--    - MENYISIPKAN baris laporan pada periode draft
--    - mengajukan periode ke status submitted
--
--  Yang terakhir dua itu yang berbahaya: menonaktifkan profil adalah cara
--  sistem ini mencabut hak seseorang, dan sampai migrasi ini hal itu tidak
--  mencabut apa pun bagi staf entitas.
--
--  Peran lain sudah aman secara kebetulan: can_read_all_entities() dan
--  can_approve() memanggil current_user_role(), yang memang sudah memfilter
--  is_active. Hanya cabang user_entity_access yang bocor.
--
--  Migrasi maju-saja: fungsi didefinisikan ulang, policy tidak disentuh.
--  Seluruh policy memanggil fungsi ini, jadi satu perbaikan menutup semuanya.
-- =====================================================================

create or replace function has_entity_access(target_entity uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    can_read_all_entities()
    or exists (
      select 1
      from user_entity_access uea
      join profiles p on p.id = uea.user_id
      where uea.user_id   = auth.uid()
        and uea.entity_id = target_entity
        and p.is_active
    );
$$;

comment on function has_entity_access(uuid) is
  'Akses entitas untuk staf. Wajib profil aktif — menonaktifkan profil mencabut baca dan tulis.';


-- Peran yang tidak dikenal bukan peran yang boleh menulis.
--
-- Versi lama mengembalikan false saat current_user_role() NULL, sehingga
-- `not is_readonly_role()` pada policy tulis justru bernilai true untuk
-- pengguna tanpa profil aktif sama sekali. Perbaikan di atas sudah menutup
-- jalurnya lewat has_entity_access(), tetapi kedua syarat itu berdiri
-- sendiri di setiap policy tulis, dan yang satu ini gagal-terbuka.
--
-- Tidak ada pengguna sah yang punya role NULL: profil dibuat bersamaan
-- dengan akun, dan role-nya NOT NULL.
create or replace function is_readonly_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() = 'auditor', true);
$$;

comment on function is_readonly_role() is
  'True untuk auditor, dan untuk peran yang tidak dikenal — gagal-tertutup.';
