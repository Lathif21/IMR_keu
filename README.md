# Financial Reporting Portal

Multi-entity financial reporting and consolidation portal for a holding group
of four Indonesian legal entities.

Read these before writing code:

| File | Why |
|---|---|
| [docs/CLAUDE.md](docs/CLAUDE.md) | Non-negotiable invariants. Violating one produces wrong reports. |
| [docs/CONTEXT.md](docs/CONTEXT.md) | Indonesian domain vocabulary. Mixing terms up has already produced wrong numbers once. |
| [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) | Accounting policies that are still undecided. The system surfaces them; it never picks a default. |
| [docs/TESTING.md](docs/TESTING.md) | What is still checked by hand, after `npm test`: session handling and the dashboard. |
| [docs/TESTING-WORKFLOW.md](docs/TESTING-WORKFLOW.md) | The two write screens, walked end to end. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What exists, what does not, and what comes next. |

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
| `npm test` | the regression suite — RLS, workflow triggers, guards, view arithmetic, formatting |
| `npm run test:watch` | the same, in watch mode |
| `npm run check` | `svelte-check` over the whole project |
| `npm run db:reset` | drop, re-migrate and re-seed the local database |
| `npm run db:types` | regenerate `src/lib/server/database.types.ts` from the local schema |

`npm test` runs against the local Supabase stack — start it first. It resets
its own fixture by truncating and replaying `supabase/seed.sql`, which takes
about 100ms, but it does **not** re-apply migrations: run `npm run db:reset`
once after changing the schema.

There is one more script, run by hand rather than by npm:

```sh
npx tsx scripts/import-ilj.ts <path-to-xlsx>
```

It parses ILJ's historical workbook into `supabase/seed-ilj.sql` for review. It
never writes to a database — see [docs/task/03-import-ilj.md](docs/task/03-import-ilj.md).

## Layout

```
supabase/migrations/   Schema. The source of truth. Forward-only.
supabase/seed.sql      Local development data. Never run against production.
src/lib/domain.ts      Enums and view row shapes, hand-written
src/lib/format.ts      The only layer allowed to shorten Rupiah to juta/miliar
src/lib/roles.ts       Mirror of the SQL role predicates — for UI shaping only
src/routes/(app)/      Screens behind a session
scripts/import-ilj.ts  Excel → reviewable SQL. Writes a file, never a database.
tests/                 Seven files, found by name. See docs/task/05-regression-tests.md
docs/                  Invariants, vocabulary, open decisions, roadmap
design/figma-export/   The original Figma Make React export. Reference only.
```

## Status

| Screen | Route | State |
|---|---|---|
| Dasbor Eksekutif | `/` | built |
| Laporan P&L | `/entities` → `/entities/[id]/periods/[period]` | built |
| Input Laporan | `/entry/[period]` | built |
| Persetujuan | `/approval` | built |

All four screens exist and the sidebar has no disabled item. What is missing is
data rather than code: ILJ's nine real months are still an unrun parser, since
the source workbook is not in the repo. See
[docs/ROADMAP.md](docs/ROADMAP.md).

No deployment target is chosen yet, so `@sveltejs/adapter-auto` cannot detect
a platform and `npm run build` says so. Swap in a real adapter when that is
decided.
