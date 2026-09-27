-- =====================================================================
--  INTEGRASI SISTEM OPERASIONAL (Fase 3, Tugas 10)
--
--  Tiga perubahan yang harus ada sebelum tombol "Tarik data
--  operasional" dapat menulis apa pun:
--
--    1. kolom `source` di report_lines — membedakan angka hasil tarik
--       dari angka yang diketik orang
--    2. template trucking v2 — COGS_TELLY dan COGS_PAGUYUBAN belum ada
--       di v1, dan v1 sudah dipakai periode non-draft sehingga beku
--    3. operational_sync_config — entitas mana yang ditautkan, dan ke
--       alamat mana
--
--  Token sistem operasional TIDAK disimpan di sini. Ia tinggal di
--  $env/static/private, sejalan dengan cara service role key ditangani
--  di /admin/users: yang tidak pernah masuk database tidak bisa bocor
--  lewat RLS yang salah tulis.
-- =====================================================================


-- --- 1. report_lines.source -------------------------------------------
--
--  Tanpa kolom ini, baris hasil sinkronisasi dan baris yang diketik
--  staf tidak bisa dibedakan sama sekali. Yang hilang bukan kerapian
--  melainkan kemampuan menjawab satu pertanyaan yang pasti muncul saat
--  angkanya diperdebatkan: "ini angka mentah dari sistem operasional,
--  atau sudah ada yang mengoreksinya?"
--
--  Ini bukan pelanggaran invarian 2. Kolom ini menerangkan asal sebuah
--  baris input; ia tidak menyimpan subtotal dan tidak ikut perhitungan
--  mana pun.
--
--  `not null default 'manual'` supaya seluruh baris yang sudah ada dan
--  seluruh jalur tulis yang sudah berjalan tidak perlu diubah sedikit
--  pun. Form input tidak mengirim kolom ini, jadi koreksi manual atas
--  baris hasil tarik data akan mengembalikannya ke 'manual' — dan itu
--  memang yang ingin ditandai.

alter table report_lines
  add column source text not null default 'manual';

alter table report_lines
  add constraint report_lines_source_check
  check (source in ('manual', 'operasional', 'import'));

comment on column report_lines.source is
  'Asal baris: manual (diketik di /entry), operasional (tarik data dari '
  'sistem operasional ILJ), import (scripts/import-ilj.ts). Koreksi lewat '
  'form mengembalikan nilainya ke manual.';


-- --- 2. Template trucking v2 ------------------------------------------
--
--  COGS_TELLY dan COGS_PAGUYUBAN ada di sistem operasional sejak awal
--  (tabel gaji_telly dan paguyuban) tetapi tidak pernah ada di template
--  laporan. Selama itu, sinkronisasi akan ditolak
--  guard_line_code_in_template untuk dua baris tersebut.
--
--  v1 tidak disunting. Ia sudah dipakai periode non-draft, dan mengubah
--  template yang sudah terpakai akan mengubah bentuk laporan historis
--  secara surut. Jalur satu-satunya adalah versi baru.
--
--  Baris v1 disalin lewat insert-select, bukan diketik ulang. Salinan
--  yang diketik ulang adalah salinan yang cepat atau lambat berbeda.

insert into report_templates (id, code, name, business_line, version)
values (
  '11111111-1111-1111-1111-111111111112',
  'TRUCKING_V2',
  'Laporan Laba Rugi — Jasa Angkutan (v2)',
  'trucking',
  2
);

insert into report_template_lines
  (template_id, line_code, line_label, section, sort_order, account_code, help_text, is_active)
select
  '11111111-1111-1111-1111-111111111112',
  line_code, line_label, section, sort_order, account_code, help_text, is_active
from report_template_lines
where template_id = '11111111-1111-1111-1111-111111111111';

insert into report_template_lines
  (template_id, line_code, line_label, section, sort_order, help_text)
values
  ('11111111-1111-1111-1111-111111111112', 'COGS_TELLY',     'Upah Telly',        'cogs', 160, 'Upah telly per kegiatan. Gaji admin dan staf non-telly bukan di sini — masukkan ke Gaji Karyawan.'),
  ('11111111-1111-1111-1111-111111111112', 'COGS_PAGUYUBAN', 'Iuran Paguyuban',   'cogs', 170, 'Iuran paguyuban per kegiatan, dihitung dari tonase');

--  Periode baru memilih template dengan versi tertinggi yang masih
--  aktif (lihat entry/+page.server.ts). Menonaktifkan v1 karena itu
--  bukan sekadar kerapian: selama keduanya aktif, layar admin
--  menampilkan dua template trucking dan tidak ada yang tahu mana yang
--  berlaku.
--
--  Periode lama tetap terbaca. Mereka menunjuk template_id v1, dan
--  baris-baris v1 (report_template_lines.is_active) tidak disentuh —
--  yang dimatikan hanya penanda aktif di header templatenya.

update report_templates
   set is_active = false
 where id = '11111111-1111-1111-1111-111111111111';


-- --- 3. operational_sync_config ---------------------------------------
--
--  Entitas mana yang ditautkan ke sistem operasional, dan ke alamat
--  mana. Satu baris per entitas; entitas yang tidak punya baris tidak
--  menampilkan tombol tarik data sama sekali.
--
--  Tidak ada kolom token. Lihat catatan di kepala berkas.

create table operational_sync_config (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null unique references entities(id) on delete cascade,

  -- Alamat dasar sistem operasional, tanpa garis miring penutup.
  -- Contoh: https://operasional.example.com
  base_url    text not null,

  -- Menonaktifkan tautan tanpa menghapus konfigurasinya. Menghapus lalu
  -- membuat ulang akan kehilangan jejak audit alamat sebelumnya.
  is_active   boolean not null default true,

  -- Tidak ada kolom `last_sync_at`. Waktu tarik terakhir hanya
  -- ditampilkan setelah tombol ditekan, dan menyimpannya di sini akan
  -- menuntut staf entitas punya izin UPDATE atas tabel konfigurasi —
  -- izin yang tidak ada alasannya untuk diberikan. Jejak kapan angka
  -- berubah sudah ada di audit_log report_lines.

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint operational_sync_config_base_url_check
    check (base_url ~ '^https?://' and base_url !~ '/$')
);

create trigger operational_sync_config_updated_at before update on operational_sync_config
  for each row execute function set_updated_at();

--  Invarian 4: audit ditulis trigger, bukan kode aplikasi. Alamat
--  sistem operasional menentukan dari mana angka laporan berasal —
--  perubahannya harus meninggalkan jejak sama seperti perubahan peran.
create trigger audit_sync_config after insert or update or delete on operational_sync_config
  for each row execute function audit_row();

--  Invarian 1: tabel baru wajib punya policy RLS. Tanpa `enable row
--  level security`, tabel ini terbuka penuh untuk setiap pengguna
--  bersesi.
alter table operational_sync_config enable row level security;

--  Dibaca oleh siapa pun yang berhak atas entitasnya — layar input
--  butuh tahu apakah tombol tarik data ditampilkan. Ditulis hanya
--  direksi, seperti seluruh konfigurasi lain di sistem ini.
create policy sync_config_select on operational_sync_config for select to authenticated
  using (has_entity_access(entity_id));

create policy sync_config_manage on operational_sync_config for all to authenticated
  using (current_user_role() = 'direksi')
  with check (current_user_role() = 'direksi');

--  RLS mempersempit hak akses, bukan memberikannya. Tanpa GRANT, seluruh
--  query dari aplikasi gagal 42501 "permission denied" betapapun benar
--  policy-nya — tabel yang dibuat lewat migrasi tidak mewarisi grant apa
--  pun. Peran 'anon' tetap tidak diberi apa pun: portal butuh login.
--
--  DELETE ikut diberikan karena sync_config_manage adalah policy FOR ALL;
--  grant tidak boleh lebih luas daripada aturannya, dan di sini keduanya
--  sama luas.
grant select, insert, update, delete on operational_sync_config to authenticated;
