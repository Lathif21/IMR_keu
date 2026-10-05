-- =====================================================================
--  PEMETAAN BIAYA OPERASIONAL KE POS LAPORAN
--
--  Keputusan 4 Oktober 2026: jenis pengeluaran dari sistem operasional
--  dipetakan ke pos laporan di portal ini, bukan di Laravel. Sistem
--  operasional mengirim biaya per (sumber, jenis) apa adanya; portal
--  yang memutuskan masuk pos mana.
--
--  Jenis yang belum dipetakan TIDAK menghentikan tarik data lagi. Ia
--  masuk OPEX_LAIN (Beban Operasional Lain) dan disebut satu per satu di
--  layar input — dipilih pemilik sistem, dicatat di
--  docs/task/10-integrasi-operasional.md. Yang tetap dilarang adalah
--  fallback yang diam: daftarnya selalu ditampilkan.
-- =====================================================================

create table operational_expense_mapping (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references entities(id) on delete cascade,

  -- Asal angka di sistem operasional:
  --   pengeluaran  tabel pengeluaran, dikelompokkan per kolom `jenis`
  --   honor_telly  gaji admin bulanan yang dicatat di Honor Telly
  --
  -- Dipisah supaya pengeluaran berjenis "Gaji Admin Bulanan" (kalau suatu
  -- saat ada) tidak bertabrakan dengan baris gaji admin dari Honor Telly.
  -- Keduanya bisa saja gaji yang sama, dan memilih salah satunya adalah
  -- inti dari tabel ini.
  source      text not null,

  -- Dicocokkan persis, termasuk besar-kecil huruf, sama seperti di sisi
  -- Laravel. Dua ejaan yang berbeda dipetakan dua kali, bukan ditebak sama.
  jenis       text not null,

  -- Kode pos di template laporan, misalnya OPEX_GAJI.
  --
  -- NULL berarti "tidak ditarik": biaya ini sengaja tidak dimasukkan ke
  -- pos mana pun karena sudah tercatat di tempat lain (gaji admin yang
  -- juga dicatat sebagai pengeluaran) atau diisi manual. Itu keputusan
  -- yang tercatat, berbeda dari jenis yang belum punya baris di sini
  -- sama sekali — yang terakhir masuk OPEX_LAIN.
  --
  -- Tidak ada foreign key: line_code hanya unik per template, dan
  -- templatenya berversi. Kode yang tidak ada di template periode ditolak
  -- action tarik data sebelum satu baris pun ditulis.
  line_code   text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint operational_expense_mapping_source_check
    check (source in ('pengeluaran', 'honor_telly')),
  constraint operational_expense_mapping_jenis_check
    check (length(trim(jenis)) > 0),
  constraint operational_expense_mapping_unique
    unique (entity_id, source, jenis)
);

comment on table operational_expense_mapping is
  'Pemetaan (sumber, jenis) biaya dari sistem operasional ke line_code laporan. '
  'line_code NULL = sengaja tidak ditarik. Jenis tanpa baris di sini masuk OPEX_LAIN '
  'dan ditampilkan di layar input.';

create trigger operational_expense_mapping_updated_at before update on operational_expense_mapping
  for each row execute function set_updated_at();

--  Invarian 4. Pemetaan menentukan pos mana yang menampung sebuah biaya;
--  memindahkannya mengubah laporan berikutnya, jadi jejaknya wajib ada.
create trigger audit_expense_mapping after insert or update or delete on operational_expense_mapping
  for each row execute function audit_row();

--  Invarian 1.
alter table operational_expense_mapping enable row level security;

--  Dibaca oleh siapa pun yang berhak atas entitasnya: action tarik data
--  berjalan dengan sesi staf entitas dan harus bisa membaca pemetaannya.
--  Ditulis hanya direksi, seperti operational_sync_config.
create policy expense_mapping_select on operational_expense_mapping for select to authenticated
  using (has_entity_access(entity_id));

create policy expense_mapping_manage on operational_expense_mapping for all to authenticated
  using (current_user_role() = 'direksi')
  with check (current_user_role() = 'direksi');

grant select, insert, update, delete on operational_expense_mapping to authenticated;
