-- =====================================================================
--  Data awal production di Neon. Dijalankan oleh
--  `scripts/neon-migrate.ts --bootstrap`, setelah migrasi.
--
--  Berbeda dari seed.sql: tidak ada akun, periode, atau angka laporan.
--  Hanya yang dibutuhkan portal untuk bisa dipakai sama sekali. Aman
--  dijalankan ulang; baris yang sudah ada tidak disentuh.
--
--  Tanpa request.jwt.claims, jadi audit_log mencatat actor_id NULL:
--  yang menulis adalah penyiapan sistem, bukan seseorang.
-- =====================================================================

insert into entities (id, code, legal_name, npwp, business_line, icon_key, theme_color) values
  ('e0000000-0000-4000-a000-000000000001', 'ILJ',     'PT Indo Moda Raya',                                    null, 'trucking', 'truck',   '#3B82F6'),
  ('e0000000-0000-4000-a000-000000000002', 'AMDK',    '(nama badan hukum belum dikonfirmasi) - lini AMDK',    null, 'amdk',     'droplet', '#8B5CF6'),
  ('e0000000-0000-4000-a000-000000000003', 'TAMBANG', '(nama badan hukum belum dikonfirmasi) - lini tambang', null, 'mining',   'pickaxe', '#F59E0B'),
  ('e0000000-0000-4000-a000-000000000004', 'GARAM',   '(nama badan hukum belum dikonfirmasi) - lini garam',   null, 'salt',     'waves',   '#22C55E')
on conflict (id) do nothing;

-- Hanya ILJ yang punya sistem operasional. Token tidak di sini, tetapi di
-- OPERATIONAL_SYNC_TOKEN pada env Vercel.
insert into operational_sync_config (entity_id, base_url) values
  ('e0000000-0000-4000-a000-000000000001', 'https://imr-operasional.vercel.app')
on conflict (entity_id) do nothing;
