-- =====================================================================
--  PORTAL PELAPORAN & KONSOLIDASI KEUANGAN GRUP
--  Skema PostgreSQL / Supabase — Milestone 1 & 2
--
--  Cakupan : entitas, pengguna, template laporan, periode, baris
--            laporan, transaksi antar-perusahaan, register kebijakan,
--            audit trail, RLS, view pelaporan.
--
--  Di luar cakupan (sengaja) : chart of accounts, jurnal double-entry,
--            neraca, multi-currency, dimensi cost center.
--            Kolom `account_code` disediakan nullable sebagai jalur
--            naik kelas tanpa refactor.
--
--  Target   : PostgreSQL 15+ (Supabase)
-- =====================================================================


-- =====================================================================
--  BAGIAN 1 — EXTENSION & TIPE
-- =====================================================================

create extension if not exists "pgcrypto";

create type user_role as enum (
  'direksi',            -- baca semua, boleh membuka kunci periode
  'manajer_keuangan',   -- baca semua, approve, kunci, kelola antar-perusahaan
  'staf_entitas',       -- baca/tulis entitas sendiri saja
  'auditor'             -- baca semua, tanpa tulis
);

create type period_status as enum (
  'draft',       -- sedang diisi entitas
  'submitted',   -- diajukan, menunggu review
  'approved',    -- disetujui, masuk konsolidasi
  'locked'       -- final, tidak dapat diubah
);

create type line_section as enum (
  'revenue',
  'cogs',
  'opex',
  'other_income',
  'other_expense',
  'tax'
);

-- Default 'unknown' disengaja: sistem tidak menebak kebijakan akuntansi.
create type reporting_basis as enum ('cash', 'accrual', 'unknown');
create type revenue_presentation as enum ('gross', 'net', 'unknown');


-- =====================================================================
--  BAGIAN 2 — ENTITAS
-- =====================================================================

create table entities (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique,
  legal_name              text not null,
  npwp                    text unique,
  business_line           text not null,

  -- Tampilan. icon_key adalah STRING, bukan komponen React
  -- (prototipe menyimpan `icon: Truck` yang tidak dapat diserialisasi).
  icon_key                text not null default 'building',
  theme_color             text not null default '#64748b',

  -- Disediakan sejak awal: kepemilikan < 100% memerlukan
  -- perhitungan kepentingan non-pengendali di kemudian hari.
  ownership_pct           numeric(5,2) not null default 100
                            check (ownership_pct > 0 and ownership_pct <= 100),

  fiscal_year_start_month smallint not null default 1
                            check (fiscal_year_start_month between 1 and 12),

  -- Metadata basis pelaporan. 'unknown' = belum ditetapkan.
  -- Dashboard WAJIB memberi peringatan saat membandingkan entitas
  -- dengan basis berbeda atau yang masih 'unknown'.
  reporting_basis         reporting_basis not null default 'unknown',
  revenue_presentation    revenue_presentation not null default 'unknown',

  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on column entities.revenue_presentation is
  'gross = omset penuh (prinsipal); net = selisih (agen). Lihat Q1 daftar pertanyaan akuntan.';


-- =====================================================================
--  BAGIAN 3 — PENGGUNA & HAK AKSES
-- =====================================================================

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  role        user_role not null,
  phone       text,                        -- format E.164, untuk eskalasi WhatsApp
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Hanya relevan untuk role 'staf_entitas'.
-- Role lain memiliki akses baca ke seluruh entitas lewat RLS.
create table user_entity_access (
  user_id     uuid not null references profiles(id) on delete cascade,
  entity_id   uuid not null references entities(id) on delete cascade,
  granted_by  uuid references profiles(id),
  granted_at  timestamptz not null default now(),
  primary key (user_id, entity_id)
);


-- =====================================================================
--  BAGIAN 4 — TEMPLATE LAPORAN
--
--  Template disimpan sebagai DATA, bukan sebagai kode. Perubahan
--  struktur laporan tidak memerlukan deploy ulang.
-- =====================================================================

create table report_templates (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  name          text not null,
  business_line text,                       -- null = berlaku umum
  version       int not null default 1,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (code, version)
);

create table report_template_lines (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references report_templates(id) on delete cascade,

  line_code    text not null,               -- 'REV_TAGIHAN', 'COGS_REKANAN'
  line_label   text not null,               -- teks yang dilihat pengguna
  section      line_section not null,
  sort_order   int not null,

  -- JALUR NAIK KELAS.
  -- Kosong selama sistem berjalan sebagai portal pelaporan.
  -- Saat COA ditetapkan, kolom ini diisi tanpa mengubah
  -- lapisan input, approval, maupun pelaporan.
  account_code text,

  help_text    text,                        -- panduan singkat untuk penginput
  is_active    boolean not null default true,

  unique (template_id, line_code),
  unique (template_id, sort_order)
);

comment on column report_template_lines.account_code is
  'Nullable. Diisi hanya bila chart of accounts sudah ditetapkan (Fase 2).';


-- =====================================================================
--  BAGIAN 5 — PERIODE
-- =====================================================================

create table periods (
  id             uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references entities(id) on delete restrict,

  -- Selalu tanggal 1 bulan yang bersangkutan.
  period         date not null,

  -- Template yang berlaku saat periode dibuat. Disimpan agar
  -- laporan historis tetap konsisten meski template berubah.
  template_id    uuid not null references report_templates(id) on delete restrict,

  status         period_status not null default 'draft',

  submitted_by   uuid references profiles(id),
  submitted_at   timestamptz,
  approved_by    uuid references profiles(id),
  approved_at    timestamptz,
  locked_by      uuid references profiles(id),
  locked_at      timestamptz,

  rejection_note text,

  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (entity_id, period),
  constraint period_must_be_first_day check (extract(day from period) = 1)
);

create index periods_entity_period_idx on periods (entity_id, period desc);
create index periods_status_idx        on periods (status) where status <> 'locked';


-- =====================================================================
--  BAGIAN 6 — BARIS LAPORAN (tabel fakta)
--
--  Hanya menyimpan baris INPUT. Subtotal (laba kotor, laba bersih)
--  dihitung di view, tidak pernah disimpan — sehingga tidak pernah
--  bisa tidak sinkron dengan komponennya.
-- =====================================================================

create table report_lines (
  id         uuid primary key default gen_random_uuid(),
  period_id  uuid not null references periods(id) on delete cascade,

  -- Disimpan sebagai teks, bukan FK ke report_template_lines.
  -- Alasan: template dapat berubah versi; data historis harus
  -- tetap terbaca dengan label periode saat itu.
  line_code  text not null,

  -- numeric, BUKAN float. Rupiah penuh, bukan "juta" atau "miliar".
  amount     numeric(18,2) not null default 0,

  note       text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (period_id, line_code)
);

create index report_lines_period_idx on report_lines (period_id);


-- =====================================================================
--  BAGIAN 7 — TRANSAKSI ANTAR-PERUSAHAAN
--
--  Satu-satunya hal yang tidak dapat dikerjakan masing-masing PT.
--  Tanpa eliminasi, omset grup dihitung ganda.
-- =====================================================================

create table intercompany_transactions (
  id                uuid primary key default gen_random_uuid(),
  period            date not null,

  seller_entity_id  uuid not null references entities(id) on delete restrict,
  buyer_entity_id   uuid not null references entities(id) on delete restrict,

  amount            numeric(18,2) not null check (amount > 0),
  description       text not null,

  -- Baris mana yang dieliminasi di masing-masing sisi.
  seller_line_code  text,
  buyer_line_code   text,

  evidence_url      text,

  recorded_by       uuid references profiles(id),
  recorded_at       timestamptz not null default now(),

  constraint different_entities check (seller_entity_id <> buyer_entity_id),
  constraint ic_period_first_day check (extract(day from period) = 1)
);

create index ic_period_idx on intercompany_transactions (period);


-- =====================================================================
--  BAGIAN 8 — REGISTER KEBIJAKAN AKUNTANSI
--
--  Menampilkan lubang, bukan menutupinya. chosen_value NULL berarti
--  belum diputuskan — sistem tidak mengisi dengan asumsi, dan laporan
--  diberi penanda "sementara" selama masih kosong.
-- =====================================================================

create table accounting_policies (
  id             uuid primary key default gen_random_uuid(),
  policy_key     text not null,
  entity_id      uuid references entities(id) on delete cascade,  -- null = seluruh grup

  chosen_value   text,                       -- NULL = belum diputuskan

  -- Wajib diisi bila chosen_value terisi (lihat constraint di bawah).
  rationale      text,
  decided_by     text,
  decided_at     date,
  effective_from date,
  evidence_url   text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Keputusan tidak boleh dibuat tanpa alasan dan penanggung jawab.
  constraint decision_requires_accountability check (
    chosen_value is null
    or (rationale is not null and decided_by is not null and effective_from is not null)
  )
);

-- effective_from WAJIB null selama kebijakan belum diputuskan (lihat check
-- constraint di atas), dan NULL tidak pernah sama dengan NULL di indeks
-- unik — sehingga versi tanpa coalesce sama sekali tidak mencegah duplikat
-- justru pada baris yang paling mungkin diisi dua kali. Dasbor menghitung
-- baris ber-chosen_value NULL, jadi duplikat langsung menggelembungkan
-- jumlah "kebijakan belum diputuskan".
create unique index accounting_policies_unique_idx
  on accounting_policies (
    policy_key,
    coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(effective_from, '-infinity'::date)
  );


-- =====================================================================
--  BAGIAN 9 — AUDIT LOG
--
--  Ditulis oleh TRIGGER, bukan oleh aplikasi. Trigger tidak dapat
--  dilewati — termasuk lewat Supabase Studio atau psql langsung.
-- =====================================================================

create table audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  table_name  text not null,
  record_pk   text not null,
  action      text not null,                -- INSERT | UPDATE | DELETE
  old_value   jsonb,
  new_value   jsonb
);

create index audit_log_table_record_idx on audit_log (table_name, record_pk);
create index audit_log_occurred_idx     on audit_log (occurred_at desc);
create index audit_log_actor_idx        on audit_log (actor_id);


-- =====================================================================
--  BAGIAN 10 — FUNGSI PEMBANTU
--
--  SECURITY DEFINER agar tidak terjadi rekursi RLS saat policy
--  membaca tabel profiles.
-- =====================================================================

create or replace function current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid() and is_active = true;
$$;

create or replace function is_readonly_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() = 'auditor', false);
$$;

create or replace function can_read_all_entities()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() in ('direksi', 'manajer_keuangan', 'auditor'), false);
$$;

create or replace function can_approve()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_user_role() in ('direksi', 'manajer_keuangan'), false);
$$;

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
      select 1 from user_entity_access
      where user_id = auth.uid() and entity_id = target_entity
    );
$$;

create or replace function period_is_editable(target_period uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from periods
    where id = target_period and status = 'draft'
  );
$$;


-- =====================================================================
--  BAGIAN 11 — TRIGGER
-- =====================================================================

-- --- 11a. updated_at otomatis -----------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger entities_updated_at    before update on entities
  for each row execute function set_updated_at();
create trigger profiles_updated_at    before update on profiles
  for each row execute function set_updated_at();
create trigger periods_updated_at     before update on periods
  for each row execute function set_updated_at();
create trigger report_lines_updated_at before update on report_lines
  for each row execute function set_updated_at();
create trigger policies_updated_at    before update on accounting_policies
  for each row execute function set_updated_at();


-- --- 11b. Audit trail generik -----------------------------------------

create or replace function audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_pk  text;
begin
  v_row := coalesce(to_jsonb(new), to_jsonb(old));
  v_pk  := v_row ->> 'id';

  -- Tidak semua tabel yang diaudit memiliki kolom `id`:
  -- user_entity_access berkunci komposit (user_id, entity_id). Ambil
  -- kolom kunci primer dari katalog agar record_pk tetap terisi —
  -- audit_log.record_pk NOT NULL, sehingga versi yang hanya membaca
  -- 'id' membuat tabel berkunci komposit mustahil ditulis.
  if v_pk is null then
    select string_agg(v_row ->> a.attname, ':' order by k.ord)
      into v_pk
    from pg_index i
    cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a
      on a.attrelid = i.indrelid
     and a.attnum   = k.attnum
    where i.indrelid = tg_relid
      and i.indisprimary;
  end if;

  insert into audit_log (actor_id, table_name, record_pk, action, old_value, new_value)
  values (
    auth.uid(),
    tg_table_name,
    v_pk,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;

create trigger audit_entities   after insert or update or delete on entities
  for each row execute function audit_row();
create trigger audit_periods    after insert or update or delete on periods
  for each row execute function audit_row();
create trigger audit_lines      after insert or update or delete on report_lines
  for each row execute function audit_row();
create trigger audit_ic         after insert or update or delete on intercompany_transactions
  for each row execute function audit_row();
create trigger audit_policies   after insert or update or delete on accounting_policies
  for each row execute function audit_row();
create trigger audit_access     after insert or update or delete on user_entity_access
  for each row execute function audit_row();


-- --- 11c. Audit log tidak dapat diubah --------------------------------

create or replace function reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log bersifat append-only dan tidak dapat diubah atau dihapus';
end;
$$;

create trigger audit_log_immutable before update or delete on audit_log
  for each row execute function reject_audit_mutation();


-- --- 11d. Periode non-draft tidak dapat diubah ------------------------
--  Ditegakkan di database, bukan di aplikasi.

create or replace function guard_period_editable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_status    period_status;
begin
  v_period_id := coalesce(new.period_id, old.period_id);
  select status into v_status from periods where id = v_period_id;

  if v_status <> 'draft' then
    raise exception
      'Baris laporan tidak dapat diubah: periode berstatus %. Kembalikan ke draft terlebih dahulu.',
      v_status;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger report_lines_guard before insert or update or delete on report_lines
  for each row execute function guard_period_editable();


-- --- 11d-bis. line_code harus ada pada template periode ---------------
--
--  v_period_pnl menjumlahkan lewat join ke report_template_lines. Baris
--  dengan line_code yang tidak ada di template menghasilkan section NULL,
--  sehingga tidak masuk ke SATU PUN `filter (where tl.section = ...)`:
--  nominalnya hilang dari pendapatan, beban, dan laba bersih tanpa error.
--  Salah ketik satu kode membuat laporan tetap "seimbang" tapi salah.
--
--  Ini bukan foreign key karena template_id ada di `periods`, bukan di
--  `report_lines` — FK tidak dapat menyeberangi tabel seperti itu.

create or replace function guard_line_code_in_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
begin
  select template_id into v_template_id from periods where id = new.period_id;

  if not exists (
    select 1 from report_template_lines tl
    where tl.template_id = v_template_id
      and tl.line_code   = new.line_code
      and tl.is_active
  ) then
    raise exception
      'Kode baris % tidak ada (atau tidak aktif) pada template periode ini',
      new.line_code;
  end if;

  return new;
end;
$$;

create trigger report_lines_template_guard before insert or update on report_lines
  for each row execute function guard_line_code_in_template();


-- --- 11e. Periode baru selalu lahir sebagai draft ---------------------
--
--  guard_period_transition() hanya berjalan pada UPDATE. Tanpa penjaga
--  INSERT, policy periods_insert mengizinkan staf entitas membuat periode
--  yang langsung berstatus 'approved' — melewati seluruh alur persetujuan,
--  dan dihitung dasbor sebagai entitas yang sudah melapor meski tidak ada
--  satu pun baris laporan di dalamnya.

create or replace function guard_period_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'draft' then
    raise exception 'Periode baru harus berstatus draft, bukan %', new.status;
  end if;

  -- Kolom jejak alur kerja hanya boleh diisi oleh transisi yang sah.
  new.submitted_by := null;
  new.submitted_at := null;
  new.approved_by  := null;
  new.approved_at  := null;
  new.locked_by    := null;
  new.locked_at    := null;

  -- Pembuat adalah pengguna yang sedang masuk. Nilai yang dikirim klien
  -- tidak dipercaya; nilai dari seed (auth.uid() null) dibiarkan apa adanya.
  new.created_by := coalesce(auth.uid(), new.created_by);

  return new;
end;
$$;

create trigger periods_insert_guard before insert on periods
  for each row execute function guard_period_insert();


-- --- 11f. Transisi status periode yang sah ----------------------------

create or replace function guard_period_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  -- Transisi yang diizinkan
  if not (
       (old.status = 'draft'     and new.status = 'submitted')
    or (old.status = 'submitted' and new.status in ('approved', 'draft'))
    or (old.status = 'approved'  and new.status in ('locked', 'draft'))
    or (old.status = 'locked'    and new.status = 'draft')
  ) then
    raise exception 'Transisi status tidak sah: % -> %', old.status, new.status;
  end if;

  -- Kolom pelaku harus benar-benar pelakunya. Tanpa ini jejak audit dapat
  -- diisi nama orang lain — dan, yang lebih parah, pemisahan tugas di bawah
  -- dapat dilewati hanya dengan TIDAK mengisi approved_by: versi lama
  -- membandingkan `new.approved_by = old.submitted_by`, yang menghasilkan
  -- NULL (bukan true) saat approved_by kosong, sehingga cek tidak berjalan.
  -- Sesi tanpa auth.uid() (psql/service role) lolos di sini dan dihentikan
  -- oleh can_approve() di bawah, yang juga NULL untuk sesi seperti itu.
  if auth.uid() is not null then
    if new.status = 'submitted' and new.submitted_by is distinct from auth.uid() then
      raise exception 'submitted_by harus pengguna yang sedang masuk';
    end if;
    if new.status = 'approved' and new.approved_by is distinct from auth.uid() then
      raise exception 'approved_by harus pengguna yang sedang masuk';
    end if;
    if new.status = 'locked' and new.locked_by is distinct from auth.uid() then
      raise exception 'locked_by harus pengguna yang sedang masuk';
    end if;
  end if;

  -- Segregation of duties, aman terhadap NULL.
  if new.status = 'approved'
     and new.approved_by is not distinct from old.submitted_by then
    raise exception 'Pengaju tidak dapat menyetujui submission-nya sendiri';
  end if;

  -- Approve dan lock hanya oleh peran berwenang.
  if new.status in ('approved', 'locked') and not can_approve() then
    raise exception 'Peran Anda tidak berwenang menyetujui atau mengunci periode';
  end if;

  -- Membatalkan persetujuan mengeluarkan entitas dari konsolidasi dan
  -- membuka kembali report_lines. Itu wewenang yang sama dengan menyetujui,
  -- bukan wewenang staf entitas atas periodenya sendiri.
  if old.status = 'approved' and new.status = 'draft' and not can_approve() then
    raise exception 'Peran Anda tidak berwenang membatalkan persetujuan periode';
  end if;

  -- Membuka kunci hanya oleh direksi, dan selalu tercatat di audit log.
  if old.status = 'locked' and new.status = 'draft'
     and current_user_role() <> 'direksi' then
    raise exception 'Hanya direksi yang dapat membuka periode yang sudah dikunci';
  end if;

  -- Setiap pengembalian ke draft wajib disertai catatan, bukan hanya
  -- penolakan dari 'submitted'. Membuka kembali periode yang sudah
  -- disetujui atau dikunci justru lebih perlu alasan tertulis.
  if new.status = 'draft'
     and old.status in ('submitted', 'approved', 'locked')
     and coalesce(trim(new.rejection_note), '') = '' then
    raise exception 'Pengembalian ke draft wajib disertai catatan alasan';
  end if;

  return new;
end;
$$;

create trigger periods_transition_guard before update on periods
  for each row execute function guard_period_transition();


-- =====================================================================
--  BAGIAN 12 — ROW LEVEL SECURITY
--
--  Ini adalah batas keamanan sesungguhnya. Kesalahan di lapisan
--  aplikasi tidak akan membocorkan data lintas entitas.
-- =====================================================================

alter table entities                  enable row level security;
alter table profiles                  enable row level security;
alter table user_entity_access        enable row level security;
alter table report_templates          enable row level security;
alter table report_template_lines     enable row level security;
alter table periods                   enable row level security;
alter table report_lines              enable row level security;
alter table intercompany_transactions enable row level security;
alter table accounting_policies       enable row level security;
alter table audit_log                 enable row level security;


-- --- entities ---------------------------------------------------------

create policy entities_select on entities for select to authenticated
  using (has_entity_access(id));

create policy entities_write on entities for all to authenticated
  using (current_user_role() = 'direksi')
  with check (current_user_role() = 'direksi');


-- --- profiles ---------------------------------------------------------

create policy profiles_select_self on profiles for select to authenticated
  using (id = auth.uid() or can_read_all_entities());

create policy profiles_manage on profiles for all to authenticated
  using (current_user_role() = 'direksi')
  with check (current_user_role() = 'direksi');


-- --- user_entity_access -----------------------------------------------

create policy uea_select on user_entity_access for select to authenticated
  using (user_id = auth.uid() or can_read_all_entities());

create policy uea_manage on user_entity_access for all to authenticated
  using (current_user_role() = 'direksi')
  with check (current_user_role() = 'direksi');


-- --- template (dapat dibaca semua, dikelola direksi) -------------------

create policy templates_select on report_templates for select to authenticated
  using (true);

create policy templates_manage on report_templates for all to authenticated
  using (current_user_role() = 'direksi')
  with check (current_user_role() = 'direksi');

create policy template_lines_select on report_template_lines for select to authenticated
  using (true);

create policy template_lines_manage on report_template_lines for all to authenticated
  using (current_user_role() = 'direksi')
  with check (current_user_role() = 'direksi');


-- --- periods ----------------------------------------------------------

create policy periods_select on periods for select to authenticated
  using (has_entity_access(entity_id));

create policy periods_insert on periods for insert to authenticated
  with check (has_entity_access(entity_id) and not is_readonly_role());

create policy periods_update on periods for update to authenticated
  using (has_entity_access(entity_id) and not is_readonly_role())
  with check (has_entity_access(entity_id) and not is_readonly_role());

-- Tidak ada policy DELETE: periode tidak pernah dihapus.


-- --- report_lines -----------------------------------------------------

create policy lines_select on report_lines for select to authenticated
  using (
    exists (
      select 1 from periods p
      where p.id = report_lines.period_id
        and has_entity_access(p.entity_id)
    )
  );

create policy lines_write on report_lines for all to authenticated
  using (
    not is_readonly_role()
    and exists (
      select 1 from periods p
      where p.id = report_lines.period_id
        and has_entity_access(p.entity_id)
        and p.status = 'draft'
    )
  )
  with check (
    not is_readonly_role()
    and exists (
      select 1 from periods p
      where p.id = report_lines.period_id
        and has_entity_access(p.entity_id)
        and p.status = 'draft'
    )
  );


-- --- intercompany (hanya level grup) ----------------------------------

create policy ic_select on intercompany_transactions for select to authenticated
  using (can_read_all_entities());

create policy ic_manage on intercompany_transactions for all to authenticated
  using (can_approve())
  with check (can_approve());


-- --- accounting_policies ----------------------------------------------

create policy policies_select on accounting_policies for select to authenticated
  using (true);

create policy policies_manage on accounting_policies for all to authenticated
  using (can_approve())
  with check (can_approve());


-- --- audit_log (baca saja, tanpa policy tulis) ------------------------

create policy audit_select on audit_log for select to authenticated
  using (can_read_all_entities());


-- --- HAK AKSES TABEL (GRANT) -------------------------------------------
--
--  RLS MEMPERSEMPIT hak akses, bukan memberikannya. Tanpa GRANT di bawah
--  ini setiap query dari aplikasi gagal dengan 42501 "permission denied",
--  tidak peduli sebaik apa policy-nya. Tabel yang dibuat lewat migrasi
--  tidak mewarisi grant apa pun — hanya tabel yang dibuat lewat Studio
--  yang mendapatkannya secara otomatis.
--
--  Peran 'anon' sengaja tidak diberi apa pun: seluruh portal butuh login.

grant usage on schema public to authenticated;

grant select on
  entities,
  profiles,
  user_entity_access,
  report_templates,
  report_template_lines,
  periods,
  report_lines,
  intercompany_transactions,
  accounting_policies,
  audit_log
to authenticated;

-- Hak tulis diberikan seluas policy yang ada; policy-lah yang memutuskan
-- siapa yang benar-benar boleh. Tabel tanpa policy FOR ALL tidak diberi
-- DELETE, agar grant tidak lebih luas daripada aturannya.
grant insert, update, delete on
  entities,
  profiles,
  user_entity_access,
  report_templates,
  report_template_lines,
  report_lines,
  intercompany_transactions,
  accounting_policies
to authenticated;

-- periods hanya punya policy SELECT/INSERT/UPDATE — tidak ada penghapusan
-- periode; pembatalan dilakukan dengan mengembalikan status ke draft.
grant insert, update on periods to authenticated;

-- audit_log sengaja SELECT saja. Isinya ditulis oleh trigger SECURITY
-- DEFINER milik postgres, jadi tidak ada jalur tulis dari aplikasi sama
-- sekali (invarian 4). Trigger audit_log_immutable menutup sisanya.


-- =====================================================================
--  BAGIAN 13 — VIEW PELAPORAN
--
--  security_invoker = on agar RLS pemanggil tetap berlaku.
--  Tanpa ini, view akan membocorkan data lintas entitas.
-- =====================================================================

-- --- 13a. Ringkasan laba-rugi per entitas per periode ------------------

create view v_period_pnl
with (security_invoker = on)
as
with agg as (
  select
    p.id                as period_id,
    p.entity_id,
    p.period,
    p.status,
    coalesce(sum(rl.amount) filter (where tl.section = 'revenue'),       0) as revenue,
    coalesce(sum(rl.amount) filter (where tl.section = 'cogs'),          0) as cogs,
    coalesce(sum(rl.amount) filter (where tl.section = 'opex'),          0) as opex,
    coalesce(sum(rl.amount) filter (where tl.section = 'other_income'),  0) as other_income,
    coalesce(sum(rl.amount) filter (where tl.section = 'other_expense'), 0) as other_expense,
    coalesce(sum(rl.amount) filter (where tl.section = 'tax'),           0) as tax
  from periods p
  left join report_lines rl on rl.period_id = p.id
  left join report_template_lines tl
         on tl.template_id = p.template_id
        and tl.line_code   = rl.line_code
  group by p.id, p.entity_id, p.period, p.status
)
select
  a.*,
  e.code                  as entity_code,
  e.legal_name            as entity_name,
  e.business_line,
  e.reporting_basis,
  e.revenue_presentation,
  (a.revenue - a.cogs)                                              as gross_profit,
  (a.revenue - a.cogs - a.opex)                                     as operating_profit,
  (a.revenue - a.cogs - a.opex + a.other_income - a.other_expense - a.tax)
                                                                    as net_profit,
  case when a.revenue = 0 then null
       else round((a.revenue - a.cogs - a.opex + a.other_income - a.other_expense - a.tax)
                  / a.revenue * 100, 2)
  end                                                               as net_margin_pct
from agg a
join entities e on e.id = a.entity_id;


-- --- 13b. Kelengkapan pelaporan per periode ---------------------------
--  Dashboard WAJIB menampilkan banner bila is_complete = false.
--  Prototipe mengecualikan entitas 'pending' dari total tanpa
--  penanda, sehingga angka parsial terlihat seperti angka final.

create view v_period_completeness
with (security_invoker = on)
as
-- `e.is_active` harus ada di KEDUA hitungan. Bila hanya expected yang
-- difilter, entitas yang sudah dinonaktifkan tapi punya periode disetujui
-- tetap ikut terhitung sebagai "sudah melapor", sehingga reported bisa
-- melebihi expected: is_complete selamanya false dan dasbor menampilkan
-- "-1 belum lapor".
select
  per.period,
  count(*) filter (where e.is_active)                                        as expected_entities,
  count(pd.id) filter (where e.is_active and pd.status in ('approved','locked')) as reported_entities,
  count(*) filter (where e.is_active)
    = count(pd.id) filter (where e.is_active and pd.status in ('approved','locked')) as is_complete,
  array_agg(e.code) filter (
    where e.is_active
      and (pd.id is null or pd.status not in ('approved','locked'))
  )                                                             as missing_entities
from (select distinct period from periods) per
cross join entities e
left join periods pd on pd.entity_id = e.id and pd.period = per.period
group by per.period;


-- --- 13c. Konsolidasi grup dengan eliminasi ---------------------------
--  Tiga kolom sesuai R-07: jumlah aritmetik, eliminasi, hasil konsolidasi.

create view v_group_consolidated
with (security_invoker = on)
as
with summed as (
  select
    period,
    sum(revenue)     as revenue_sum,
    sum(cogs)        as cogs_sum,
    sum(opex)        as opex_sum,
    sum(net_profit)  as net_profit_sum
  from v_period_pnl
  where status in ('approved', 'locked')
  group by period
),
-- Eliminasi hanya berlaku bila KEDUA sisi transaksi sudah masuk
-- penjumlahan. `summed` di atas hanya menghitung periode approved/locked;
-- mengeliminasi transaksi yang lawan-sisinya belum disetujui berarti
-- mengurangi omset yang belum pernah ditambahkan, dan hasil konsolidasi
-- menjadi terlalu kecil. Ini bukan pilihan kebijakan akuntansi — ini
-- konsistensi aritmetik dengan filter di `summed`.
--
-- Transaksi yang tertunda karena sebab ini tidak hilang; ia ikut lagi
-- begitu kedua periode disetujui, dan sampai saat itu banner kelengkapan
-- sudah memberi tahu bahwa angkanya belum final.
elim as (
  select ic.period, sum(ic.amount) as elimination
  from intercompany_transactions ic
  where exists (
          select 1 from periods ps
          where ps.entity_id = ic.seller_entity_id
            and ps.period    = ic.period
            and ps.status in ('approved', 'locked')
        )
    and exists (
          select 1 from periods pb
          where pb.entity_id = ic.buyer_entity_id
            and pb.period    = ic.period
            and pb.status in ('approved', 'locked')
        )
  group by ic.period
)
select
  s.period,
  s.revenue_sum,
  coalesce(e.elimination, 0)                as elimination,
  s.revenue_sum - coalesce(e.elimination,0) as revenue_consolidated,
  s.cogs_sum,
  s.opex_sum,
  -- Tanpa penyesuaian eliminasi, dan itu benar: satu baris
  -- intercompany_transactions adalah SATU nominal yang menjadi omset di
  -- satu buku dan beban di buku lawannya. Mengeliminasinya mengurangi
  -- omset dan beban dengan angka yang sama, sehingga laba bersih grup
  -- tidak berubah. Yang berubah hanyalah baris teratas dan bentuk
  -- laporannya (lihat CONTEXT.md, "Konsolidasi bukan penjumlahan").
  s.net_profit_sum                          as net_profit_consolidated,
  c.is_complete,
  c.missing_entities
from summed s
left join elim e on e.period = s.period
left join v_period_completeness c on c.period = s.period;


-- --- 13d. Perbandingan periode (MoM & YoY) ----------------------------
--  Prototipe melabeli perbandingan bulan sebelumnya sebagai "YoY".
--  Keduanya dibedakan secara eksplisit di sini.

create view v_period_comparison
with (security_invoker = on)
as
select
  cur.entity_id,
  cur.entity_code,
  cur.period,
  cur.revenue,
  cur.net_profit,
  mom.revenue     as revenue_prev_month,
  mom.net_profit  as net_profit_prev_month,
  yoy.revenue     as revenue_prev_year,
  yoy.net_profit  as net_profit_prev_year,
  case when coalesce(mom.revenue,0) = 0 then null
       else round((cur.revenue - mom.revenue) / mom.revenue * 100, 2) end as revenue_mom_pct,
  case when coalesce(yoy.revenue,0) = 0 then null
       else round((cur.revenue - yoy.revenue) / yoy.revenue * 100, 2) end as revenue_yoy_pct
from v_period_pnl cur
left join v_period_pnl mom
       on mom.entity_id = cur.entity_id
      and mom.period    = cur.period - interval '1 month'
left join v_period_pnl yoy
       on yoy.entity_id = cur.entity_id
      and yoy.period    = cur.period - interval '1 year';


-- --- 13e. Hak akses view ----------------------------------------------
--  Diberikan di sini, bukan di BAGIAN 12, karena view baru ada setelah
--  definisinya di atas. security_invoker = on berarti pemanggil butuh
--  SELECT pada view DAN pada tabel di baliknya; grant tabel ada di
--  BAGIAN 12.

grant select on
  v_period_pnl,
  v_period_completeness,
  v_group_consolidated,
  v_period_comparison
to authenticated;


-- =====================================================================
--  BAGIAN 14 — SEED
--
--  Template diturunkan dari struktur laporan laba-rugi yang sudah
--  dipakai PT Indra Langgeng Jaya selama Nov 2024 – Jul 2025.
--  Bukan rancangan baru — replikasi pos yang sudah berjalan.
-- =====================================================================

insert into report_templates (id, code, name, business_line, version)
values (
  '11111111-1111-1111-1111-111111111111',
  'TRUCKING_V1',
  'Laporan Laba Rugi — Jasa Angkutan',
  'trucking',
  1
);

insert into report_template_lines
  (template_id, line_code, line_label, section, sort_order, help_text)
values
  ('11111111-1111-1111-1111-111111111111', 'REV_TAGIHAN',    'Tagihan Jasa Angkutan',   'revenue',       10, 'Total tagihan ke pelanggan pada periode ini'),
  ('11111111-1111-1111-1111-111111111111', 'REV_LAINNYA',    'Pendapatan Lainnya',      'revenue',       20, null),

  ('11111111-1111-1111-1111-111111111111', 'COGS_PAJAK',     'Pajak atas Tagihan',      'cogs',         110, 'Pemotongan pajak atas nilai tagihan'),
  ('11111111-1111-1111-1111-111111111111', 'COGS_REKANAN',   'Bagian Rekanan',          'cogs',         120, 'Pembayaran kepada pemilik kapal/armada rekanan'),
  ('11111111-1111-1111-1111-111111111111', 'COGS_TERPAL',    'Terpal',                  'cogs',         130, 'Isi sesuai porsi yang menjadi beban entitas'),
  ('11111111-1111-1111-1111-111111111111', 'COGS_OPS',       'Operasional Armada',      'cogs',         140, null),
  ('11111111-1111-1111-1111-111111111111', 'COGS_SAKU',      'Uang Saku Operasional',   'cogs',         150, 'Isi 0 bila diperlakukan sebagai uang muka, bukan beban'),

  ('11111111-1111-1111-1111-111111111111', 'OPEX_GAJI',      'Gaji Karyawan',           'opex',         210, null),
  ('11111111-1111-1111-1111-111111111111', 'OPEX_SEWA',      'Sewa Kantor',             'opex',         220, null),
  ('11111111-1111-1111-1111-111111111111', 'OPEX_ATK',       'Beban Kantor & ATK',      'opex',         230, null),
  ('11111111-1111-1111-1111-111111111111', 'OPEX_PROF',      'Jasa Profesional',        'opex',         240, 'Konsultan pajak, notaris, dan sejenisnya'),
  ('11111111-1111-1111-1111-111111111111', 'OPEX_PERIZINAN', 'Perizinan & Retribusi',   'opex',         250, null),
  ('11111111-1111-1111-1111-111111111111', 'OPEX_LAIN',      'Beban Operasional Lain',  'opex',         260, null),

  ('11111111-1111-1111-1111-111111111111', 'OTH_INCOME',     'Pendapatan Lain-lain',    'other_income', 310, null),
  ('11111111-1111-1111-1111-111111111111', 'OTH_EXPENSE',    'Beban Lain-lain',         'other_expense',320, null),

  ('11111111-1111-1111-1111-111111111111', 'TAX_INCOME',     'Beban Pajak Penghasilan', 'tax',          410, null);


-- Kebijakan yang belum diputuskan. chosen_value sengaja NULL:
-- sistem menampilkan lubang, tidak menutupinya dengan asumsi.
insert into accounting_policies (policy_key, entity_id, chosen_value)
values
  ('revenue_presentation_trucking', null, null),   -- Q1: prinsipal atau agen
  ('uang_saku_treatment',           null, null),   -- Q2: beban atau uang muka
  ('profit_sharing_65_35',          null, null),   -- Q3: beban usaha atau distribusi laba
  ('accounting_basis',              null, null),   -- Q5: kas atau akrual
  ('accounting_standard',           null, null);   -- Q7: SAK-EMKM / ETAP / PSAK


-- =====================================================================
--  CATATAN IMPLEMENTASI
--
--  1. Buat user pertama lewat Supabase Auth, lalu isi profiles
--     dengan role 'direksi' secara manual sebelum RLS berlaku penuh.
--
--  2. Subtotal TIDAK PERNAH disimpan. Aplikasi membaca v_period_pnl.
--     Jangan menambahkan kolom gross_profit ke report_lines.
--
--  3. Nilai disimpan dalam RUPIAH PENUH. Pemformatan "juta"/"miliar"
--     hanya terjadi di lapisan tampilan.
--
--  4. Saat COA ditetapkan: isi report_template_lines.account_code,
--     tambahkan tabel chart_of_accounts, tambahkan FK. Lapisan input,
--     approval, dan pelaporan tidak berubah.
--
--  5. Backup harian wajib, dan restore diuji bulanan ke database
--     kosong. Backup yang tidak pernah diuji bukan backup.
-- =====================================================================
