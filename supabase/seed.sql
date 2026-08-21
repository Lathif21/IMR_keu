-- =====================================================================
--  DEV SEED — local development only. Never run against production.
--
--  `supabase db reset` runs this after the migrations.
--
--  What is real:
--    - PT Indra Langgeng Jaya (ILJ) — the one confirmed entity (CONTEXT.md)
--    - ILJ's Jul 2025 net result of -Rp2.178.807, and the fact that
--      Jan-Mar PPh 23 of Rp21,3jt landed in that month (ASSUMPTIONS.md A-4)
--    - COGS_REKANAN at ~83% of REV_TAGIHAN (CONTEXT.md)
--    - No intercompany transactions — A-5 says the registry ships empty
--    - Every accounting_policies row still NULL — A-1 .. A-4 are open
--
--  What is invented, and must not be mistaken for the client's books:
--    - The other three entities. Their legal names are unconfirmed
--      (CONTEXT.md, A-6), so they carry an explicit placeholder label
--      rather than the prototype's made-up PT names.
--    - Jun 2025 figures — needed to exercise the MoM comparison.
--    - The individual opex lines for both months.
-- =====================================================================

-- Triggers on `periods` call can_approve(), which resolves auth.uid().
-- Seeding as postgres bypasses RLS but NOT triggers, so every step below runs
-- under an impersonated JWT. This seed therefore goes through the same guards
-- the UI does — the segregation-of-duties check included — instead of
-- sidestepping them, and audit_log.actor_id comes out populated rather than
-- NULL, which is what the real audit trail looks like.

begin;

-- Master data is the director's to create.
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-a000-000000000001","role":"authenticated"}';

-- --- 1. Users -------------------------------------------------------------
--  Passwords are local-only. Nothing here is a credential for any deployed
--  environment, and none of it is displayed in the app — the prototype
--  printed logins on its login screen (see CLAUDE.md anti-patterns).

-- confirmation_token, recovery_token, email_change_token_new and
-- email_change have no column default, so they land NULL. GoTrue scans them
-- into non-nullable Go strings and the whole login fails with the unhelpful
-- "Database error querying schema". They must be '' , not NULL.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('a0000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'direksi@example.test',
   crypt('devpassword', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('a0000000-0000-4000-a000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'manajer@example.test',
   crypt('devpassword', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('a0000000-0000-4000-a000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'staf.ilj@example.test',
   crypt('devpassword', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('a0000000-0000-4000-a000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'auditor@example.test',
   crypt('devpassword', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');

-- GoTrue needs a matching identity row before password login works.
insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now()
from auth.users u
where u.email like '%@example.test';

insert into profiles (id, full_name, role, phone) values
  -- Names are labelled as dev accounts so nothing here reads as a real
  -- person, and so the sidebar does not print the role label twice.
  ('a0000000-0000-4000-a000-000000000001', 'Akun Dev A',  'direksi',          '+6281100000001'),
  ('a0000000-0000-4000-a000-000000000002', 'Akun Dev B',  'manajer_keuangan', '+6281100000002'),
  ('a0000000-0000-4000-a000-000000000003', 'Akun Dev C',  'staf_entitas',     '+6281100000003'),
  ('a0000000-0000-4000-a000-000000000004', 'Akun Dev D',  'auditor',          null);


-- --- 2. Entities ----------------------------------------------------------
--  reporting_basis and revenue_presentation stay 'unknown' everywhere.
--  That is the schema default and it is deliberate: A-1 and A-4 are open,
--  and the dashboard is required to say so rather than pick a value.
--
--  theme_color follows the fixed --color-line-N order in src/app.css and is
--  stored on the row, not assigned by array index, so adding an entity
--  never recolours an existing one.
--
--  icon_key is a STRING. The prototype stored `icon: Truck`, a React
--  component inside a data object, which cannot be serialised.

insert into entities (id, code, legal_name, npwp, business_line, icon_key, theme_color) values
  ('e0000000-0000-4000-a000-000000000001', 'ILJ',     'PT Indra Langgeng Jaya',                               null, 'trucking', 'truck',   '#3B82F6'),
  ('e0000000-0000-4000-a000-000000000002', 'AMDK',    '(nama badan hukum belum dikonfirmasi) - lini AMDK',    null, 'amdk',     'droplet', '#8B5CF6'),
  ('e0000000-0000-4000-a000-000000000003', 'TAMBANG', '(nama badan hukum belum dikonfirmasi) - lini tambang', null, 'mining',   'pickaxe', '#F59E0B'),
  ('e0000000-0000-4000-a000-000000000004', 'GARAM',   '(nama badan hukum belum dikonfirmasi) - lini garam',   null, 'salt',     'waves',   '#22C55E');

insert into user_entity_access (user_id, entity_id, granted_by) values
  ('a0000000-0000-4000-a000-000000000003', 'e0000000-0000-4000-a000-000000000001',
   'a0000000-0000-4000-a000-000000000001');


-- --- 3. Periods and lines -------------------------------------------------
--  Lines are only writable while the period is 'draft' (invariant 5), so
--  every period is created as draft, filled, then transitioned in step 4.
--
--  guard_period_insert() overwrites created_by with auth.uid(), so the claim
--  has to be the staff account here rather than passed as a column value.

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-a000-000000000003","role":"authenticated"}';

insert into periods (id, entity_id, period, template_id, status, created_by) values
  ('d0000000-0000-4000-a000-000000000001', 'e0000000-0000-4000-a000-000000000001',
   '2025-06-01', '11111111-1111-1111-1111-111111111111', 'draft',
   'a0000000-0000-4000-a000-000000000003'),
  ('d0000000-0000-4000-a000-000000000002', 'e0000000-0000-4000-a000-000000000001',
   '2025-07-01', '11111111-1111-1111-1111-111111111111', 'draft',
   'a0000000-0000-4000-a000-000000000003'),
  ('d0000000-0000-4000-a000-000000000003', 'e0000000-0000-4000-a000-000000000003',
   '2025-07-01', '11111111-1111-1111-1111-111111111111', 'draft',
   'a0000000-0000-4000-a000-000000000003'),
  -- AMDK stops at 'submitted': it must NOT enter consolidation, so Jul 2025
  -- is incomplete and the dashboard has to show the banner.
  ('d0000000-0000-4000-a000-000000000004', 'e0000000-0000-4000-a000-000000000002',
   '2025-07-01', '11111111-1111-1111-1111-111111111111', 'draft',
   'a0000000-0000-4000-a000-000000000003');
  -- GARAM has no period at all — the other half of "belum lapor".

-- Amounts are full Rupiah. Never "in millions" (invariant 3).

-- ILJ Jun 2025 — invented, shaped like July so MoM is meaningful.
insert into report_lines (period_id, line_code, amount, note) values
  ('d0000000-0000-4000-a000-000000000001', 'REV_TAGIHAN',    241500000, null),
  ('d0000000-0000-4000-a000-000000000001', 'COGS_PAJAK',       4830000, 'PPh 23 bulan berjalan'),
  ('d0000000-0000-4000-a000-000000000001', 'COGS_REKANAN',   200445000, '83% dari tagihan'),
  ('d0000000-0000-4000-a000-000000000001', 'COGS_TERPAL',      1450000, 'Dicatat 50% - pembagian biaya belum terdokumentasi'),
  ('d0000000-0000-4000-a000-000000000001', 'COGS_OPS',         4100000, null),
  ('d0000000-0000-4000-a000-000000000001', 'COGS_SAKU',              0, 'Historis nihil - perlakuan uang saku belum diputuskan (A-2)'),
  ('d0000000-0000-4000-a000-000000000001', 'OPEX_GAJI',        9500000, null),
  ('d0000000-0000-4000-a000-000000000001', 'OPEX_SEWA',        1500000, null),
  ('d0000000-0000-4000-a000-000000000001', 'OPEX_ATK',          680000, null),
  ('d0000000-0000-4000-a000-000000000001', 'OPEX_PROF',        1250000, null),
  ('d0000000-0000-4000-a000-000000000001', 'OPEX_PERIZINAN',    850000, null),
  ('d0000000-0000-4000-a000-000000000001', 'OPEX_LAIN',         920000, null);
--  gross 30.675.000 | opex 14.700.000 | net +15.975.000

-- ILJ Jul 2025 — the documented month. Net comes out at -2.178.807: the
-- 65/35 split that month was applied to -1,42jt / -0,76jt, which is the
-- evidence in A-3 that the split is a distribution, not an expense.
insert into report_lines (period_id, line_code, amount, note) values
  ('d0000000-0000-4000-a000-000000000002', 'REV_TAGIHAN',    235000000, null),
  ('d0000000-0000-4000-a000-000000000002', 'COGS_PAJAK',      21300000, 'PPh 23 Jan-Mar dibayar Juli - artefak basis kas (A-4)'),
  ('d0000000-0000-4000-a000-000000000002', 'COGS_REKANAN',   195050000, '83% dari tagihan'),
  ('d0000000-0000-4000-a000-000000000002', 'COGS_TERPAL',      1500000, 'Dicatat 50% - pembagian biaya belum terdokumentasi'),
  ('d0000000-0000-4000-a000-000000000002', 'COGS_OPS',         4200000, null),
  ('d0000000-0000-4000-a000-000000000002', 'COGS_SAKU',              0, 'Historis nihil - perlakuan uang saku belum diputuskan (A-2)'),
  ('d0000000-0000-4000-a000-000000000002', 'OPEX_GAJI',        9500000, null),
  ('d0000000-0000-4000-a000-000000000002', 'OPEX_SEWA',        1500000, null),
  ('d0000000-0000-4000-a000-000000000002', 'OPEX_ATK',          750000, null),
  ('d0000000-0000-4000-a000-000000000002', 'OPEX_PROF',        1250000, null),
  ('d0000000-0000-4000-a000-000000000002', 'OPEX_PERIZINAN',    850000, null),
  ('d0000000-0000-4000-a000-000000000002', 'OPEX_LAIN',        1278807, null);
--  gross 12.950.000 | opex 15.128.807 | net -2.178.807

-- TAMBANG Jul 2025 — invented. Runs at a loss, which the dashboard flags
-- without needing a margin threshold nobody has decided on.
insert into report_lines (period_id, line_code, amount) values
  ('d0000000-0000-4000-a000-000000000003', 'REV_TAGIHAN',     96400000),
  ('d0000000-0000-4000-a000-000000000003', 'COGS_OPS',        71800000),
  ('d0000000-0000-4000-a000-000000000003', 'COGS_PAJAK',       1928000),
  ('d0000000-0000-4000-a000-000000000003', 'OPEX_GAJI',       18200000),
  ('d0000000-0000-4000-a000-000000000003', 'OPEX_LAIN',        6900000);
--  net -2.428.000

-- AMDK Jul 2025 — filled but never approved, so it stays out of the total.
insert into report_lines (period_id, line_code, amount) values
  ('d0000000-0000-4000-a000-000000000004', 'REV_TAGIHAN',    112750000),
  ('d0000000-0000-4000-a000-000000000004', 'COGS_OPS',        68300000),
  ('d0000000-0000-4000-a000-000000000004', 'OPEX_GAJI',       14500000);


-- --- 4. Workflow transitions ---------------------------------------------
--  Submit as the entity staff, approve as the finance manager. Approving as
--  the submitter would trip the segregation-of-duties trigger (invariant 6),
--  which is the point: the seed passes through the same gate the UI does.
--  The claim is still the staff account from step 3.

update periods
   set status = 'submitted',
       submitted_by = 'a0000000-0000-4000-a000-000000000003',
       submitted_at = now()
 where id in ('d0000000-0000-4000-a000-000000000001',
              'd0000000-0000-4000-a000-000000000002',
              'd0000000-0000-4000-a000-000000000003',
              'd0000000-0000-4000-a000-000000000004');

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-a000-000000000002","role":"authenticated"}';

update periods
   set status = 'approved',
       approved_by = 'a0000000-0000-4000-a000-000000000002',
       approved_at = now()
 where id in ('d0000000-0000-4000-a000-000000000001',
              'd0000000-0000-4000-a000-000000000002',
              'd0000000-0000-4000-a000-000000000003');

commit;
