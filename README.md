# Financial Reporting Portal

Multi-entity financial reporting and consolidation portal for a holding group
of four Indonesian legal entities.

Read these before writing code:

| File | Why |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Non-negotiable invariants. Violating one produces wrong reports. |
| [CONTEXT.md](CONTEXT.md) | Indonesian domain vocabulary. Mixing terms up has already produced wrong numbers once. |
| [ASSUMPTIONS.md](ASSUMPTIONS.md) | Accounting policies that are still undecided. The system surfaces them; it never picks a default. |
| [TESTING.md](TESTING.md) | End-to-end checks, with the exact fixture values and the failure mode each guard prevents. Run the regression checklist before committing schema changes. |

## Stack

SvelteKit (SSR) + TypeScript · Supabase (Postgres, Auth, RLS) · Tailwind v4.
`supabase-js` is called directly — no ORM, no repository layer.

## Running it locally

Requires Node 20+, Docker Desktop, and the Supabase CLI.

```sh
npm install
cp .env.example .env      # fill in the keys `supabase start` prints
supabase start            # Postgres, Auth, Studio on 127.0.0.1
npm run db:reset          # apply migrations, then supabase/seed.sql
npm run dev
```

`supabase/seed.sql` creates four local accounts, one per role, all with the
password `devpassword`:

| Email | Role | Sees |
|---|---|---|
| `direksi@example.test` | direksi | everything; can unlock a locked period |
| `manajer@example.test` | manajer_keuangan | everything; approves and locks |
| `staf.ilj@example.test` | staf_entitas | ILJ only |
| `auditor@example.test` | auditor | everything, read-only |

These exist only in a local database. They are not printed anywhere in the UI.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run check` | `svelte-check` over the whole project |
| `npm run db:reset` | drop, re-migrate and re-seed the local database |
| `npm run db:types` | regenerate `src/lib/server/database.types.ts` from the local schema |

## Layout

```
supabase/migrations/   Schema. The source of truth. Forward-only.
supabase/seed.sql      Local development data. Never run against production.
src/lib/domain.ts      Enums and view row shapes, hand-written
src/lib/format.ts      The only layer allowed to shorten Rupiah to juta/miliar
src/lib/roles.ts       Mirror of the SQL role predicates — for UI shaping only
src/routes/(app)/      Screens behind a session
design/figma-export/   The original Figma Make React export. Reference only.
```

## Status

| Screen | Route | State |
|---|---|---|
| Dasbor Eksekutif | `/` | built |
| Laporan P&L | `/entities/[id]/periods/[period]` | not started |
| Input Laporan | `/entry/[period]` | not started |
| Persetujuan | `/approval` | not started |

No deployment target is chosen yet, so `@sveltejs/adapter-auto` cannot detect
a platform and `npm run build` says so. Swap in a real adapter when that is
decided.
