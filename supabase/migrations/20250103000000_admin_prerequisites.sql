-- =====================================================================
--  PRASYARAT LAYAR ADMIN (Fase 3, Tugas 6)
--
--  Tiga lubang di schema yang harus ditutup sebelum layar admin dibangun.
--  Masing-masing kecil; masing-masing punya alasan yang tidak boleh
--  dilewati.
-- =====================================================================


-- --- 1. Audit untuk tabel yang akan punya UI ---------------------------
--
--  Sebelum ini teraudit: entities, periods, report_lines,
--  intercompany_transactions, accounting_policies, user_entity_access.
--
--  Tidak teraudit: profiles, report_templates, report_template_lines —
--  justru tiga tabel yang Fase 3 memberinya layar. Tanpa trigger:
--
--    - perubahan peran dari staf_entitas menjadi direksi tidak
--      meninggalkan jejak apa pun
--    - perubahan `section` sebuah baris template memindahkan nominal
--      historis antar-pos laporan, juga tanpa jejak
--
--  audit_row() sudah generik; fungsinya tidak berubah.

create trigger audit_profiles after insert or update or delete on profiles
  for each row execute function audit_row();

create trigger audit_templates after insert or update or delete on report_templates
  for each row execute function audit_row();

create trigger audit_template_lines after insert or update or delete on report_template_lines
  for each row execute function audit_row();


-- --- 2. sort_order deferrable ------------------------------------------
--
--  Menukar urutan dua baris adalah dua UPDATE. Setelah UPDATE pertama,
--  dua baris sementara memegang sort_order yang sama, dan constraint
--  non-deferrable menolak tepat di titik itu — meski keadaan akhir
--  transaksi sah.
--
--  Alternatifnya menulis ke nilai negatif sementara lalu menormalkan.
--  Itu bekerja, tapi menaruh kerumitan di kode aplikasi untuk menghindari
--  satu baris SQL.
--
--  Nama constraint diverifikasi terhadap database yang berjalan sebelum
--  di-drop (\d report_template_lines).

alter table report_template_lines
  drop constraint report_template_lines_template_id_sort_order_key;

alter table report_template_lines
  add constraint report_template_lines_template_id_sort_order_key
  unique (template_id, sort_order) deferrable initially deferred;


-- --- 3. Basis pelaporan hanya berubah dengan alasan tertulis -----------
--
--  RLS mengizinkan direksi meng-update `entities` lewat jalur mana pun.
--  Menegakkan "wajib beralasan" di UI saja berarti siapa pun yang
--  memanggil PostgREST langsung dapat melewatinya — melanggar invarian 1.
--
--  Basis pelaporan bukan kolom biasa: ia mengubah arti seluruh laporan
--  entitas dan cara ia dibandingkan dengan entitas lain (CONTEXT.md,
--  "Basis pelaporan"). Perubahannya adalah keputusan akuntansi, dan
--  keputusan akuntansi di sistem ini selalu punya rationale, decided_by,
--  dan effective_from.

create or replace function guard_reporting_basis_change()
returns trigger
language plpgsql
as $$
begin
  if (new.reporting_basis is distinct from old.reporting_basis
      or new.revenue_presentation is distinct from old.revenue_presentation)
     and coalesce(current_setting('app.policy_change', true), '') <> 'on'
  then
    raise exception
      'Basis pelaporan hanya dapat diubah melalui pencatatan kebijakan beralasan';
  end if;
  return new;
end;
$$;

create trigger entities_basis_guard before update on entities
  for each row execute function guard_reporting_basis_change();


-- Satu-satunya jalur yang menyalakan flag di atas. Flag-nya
-- transaction-local (`set_config(..., true)`), jadi ia mati begitu
-- transaksi selesai — tidak ada sesi yang bisa membiarkannya menyala.
create or replace function set_entity_reporting_basis(
  p_entity_id      uuid,
  p_basis          reporting_basis,
  p_presentation   revenue_presentation,
  p_rationale      text,
  p_effective_from date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if current_user_role() <> 'direksi' then
    raise exception 'Hanya direksi yang dapat menetapkan basis pelaporan';
  end if;

  if coalesce(trim(p_rationale), '') = '' then
    raise exception 'Perubahan basis pelaporan wajib disertai alasan';
  end if;

  -- accounting_policies.decision_requires_accountability menolak keputusan
  -- tanpa tanggal berlaku. Ditangkap di sini supaya pesannya terbaca
  -- manusia, bukan nama constraint.
  if p_effective_from is null then
    raise exception 'Perubahan basis pelaporan wajib disertai tanggal mulai berlaku';
  end if;

  if not exists (select 1 from entities where id = p_entity_id) then
    raise exception 'Entitas tidak ditemukan';
  end if;

  -- Nama pemutus diambil dari profil pemanggil, bukan dari parameter:
  -- pemanggil tidak boleh mengaku sebagai orang lain.
  select full_name into v_name from profiles where id = auth.uid();

  begin
    insert into accounting_policies
      (policy_key, entity_id, chosen_value, rationale, decided_by, decided_at, effective_from)
    values
      ('reporting_basis', p_entity_id, p_basis::text,
       p_rationale, v_name, current_date, p_effective_from),
      ('revenue_presentation', p_entity_id, p_presentation::text,
       p_rationale, v_name, current_date, p_effective_from);
  exception when unique_violation then
    raise exception
      'Sudah ada penetapan basis untuk entitas ini yang berlaku sejak %. '
      'Pakai tanggal mulai berlaku yang berbeda.', p_effective_from;
  end;

  perform set_config('app.policy_change', 'on', true);

  update entities
     set reporting_basis      = p_basis,
         revenue_presentation = p_presentation
   where id = p_entity_id;
end;
$$;

comment on function set_entity_reporting_basis is
  'Satu-satunya jalur yang boleh mengubah entities.reporting_basis / revenue_presentation. Menulis alasannya ke accounting_policies dalam transaksi yang sama.';

-- Default Postgres memberi EXECUTE ke PUBLIC. Dicabut dulu, baru diberikan
-- ke role yang memang dipakai aplikasi.
revoke all on function set_entity_reporting_basis(uuid, reporting_basis, revenue_presentation, text, date) from public;
grant execute on function set_entity_reporting_basis(uuid, reporting_basis, revenue_presentation, text, date) to authenticated;


-- --- 2b. Satu pintu untuk menukar urutan -------------------------------
--
--  Constraint deferrable di atas memindahkan pemeriksaan ke COMMIT, tapi
--  PostgREST memberi setiap permintaan transaksinya sendiri: dua UPDATE
--  terpisah berarti dua COMMIT, dan yang pertama sudah melanggar. Satu
--  pernyataan UPDATE pun tidak cukup tanpa deferrable — indeks unik
--  diperiksa per baris saat baris itu ditulis, bukan di akhir pernyataan.
--
--  Jadi keduanya diperlukan: deferrable, dan satu transaksi. Fungsi ini
--  yang menyediakan transaksinya, supaya layar template tidak perlu
--  menulis ke nilai negatif sementara lalu menormalkan.
create or replace function swap_template_line_order(p_a uuid, p_b uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_a int;
  v_b int;
  v_template_a uuid;
  v_template_b uuid;
begin
  select sort_order, template_id into v_a, v_template_a
    from report_template_lines where id = p_a;
  select sort_order, template_id into v_b, v_template_b
    from report_template_lines where id = p_b;

  if v_a is null or v_b is null then
    raise exception 'Baris template tidak ditemukan';
  end if;

  -- Menukar antar-template akan memindahkan baris tanpa ada yang memintanya.
  if v_template_a is distinct from v_template_b then
    raise exception 'Kedua baris harus berada di template yang sama';
  end if;

  update report_template_lines set sort_order = v_b where id = p_a;
  update report_template_lines set sort_order = v_a where id = p_b;
end;
$$;

comment on function swap_template_line_order is
  'Menukar sort_order dua baris dalam satu transaksi. security invoker: RLS tetap berlaku, jadi hanya direksi yang berhasil.';

revoke all on function swap_template_line_order(uuid, uuid) from public;
grant execute on function swap_template_line_order(uuid, uuid) to authenticated;
