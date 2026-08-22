# Financial Reporting Portal

Multi-entity financial reporting and consolidation portal for a holding group
of four separate Indonesian legal entities (PT), each with its own NPWP.

Read `CONTEXT.md` before writing code — the domain vocabulary is Indonesian
and mixing it up produces subtly wrong reports.
Read `ASSUMPTIONS.md` before changing anything about how amounts are
calculated — several accounting policies are still undecided.

## What this is NOT

Not an ERP. Not an accounting system. There is no general ledger, no
double-entry journal, no chart of accounts, no balance sheet.

Entities submit an already-prepared profit & loss statement. This system
stores it, validates the workflow around it, and consolidates across
entities. Correctness of the numbers is each entity's responsibility.

If a task starts to look like "build the ledger", stop and ask.

## Stack

- SvelteKit (SSR) + TypeScript
- Supabase: Postgres, Auth, RLS
- Tailwind + shadcn-svelte
- `supabase-js` directly — no ORM

## Non-negotiable invariants

Violating any of these produces wrong financial reports. They are not
style preferences.

1. **Authorization lives in RLS, not in application code.** App-layer checks
   are UX, not security. Never add a table without an RLS policy.

2. **Never store subtotals.** Gross profit, operating profit and net profit
   are computed in `v_period_pnl`. Adding a `gross_profit` column to
   `report_lines` "for performance" reintroduces the exact class of bug this
   design exists to prevent.

3. **Amounts are `numeric(18,2)` and stored in full Rupiah.** Never `float`.
   Never store "in millions". Formatting to juta/miliar happens in the view
   layer only.

4. **The audit trail is written by database triggers.** Never write to
   `audit_log` from application code. Never add a code path that bypasses it.

5. **`report_lines` is only mutable while its period is `draft`.** Enforced by
   trigger. Don't work around it — route the user through reject-to-draft.

6. **A submitter cannot approve their own submission.** Enforced by trigger.

7. **Report templates are data, not code.** Adding a line means inserting a
   row into `report_template_lines`, not editing a TypeScript constant.

8. **Never invent an accounting policy.** If a calculation depends on an
   undecided policy (see `ASSUMPTIONS.md`), surface the gap in the UI instead
   of picking a default.

## Working agreement

- The schema in `supabase/migrations/` is the source of truth. Read it before
  writing queries.
- Migrations are forward-only. Never edit an applied migration.
- Don't add a dependency without saying why in the PR description. Check
  what's installed first.
- Don't add abstraction layers, repository patterns, or service wrappers
  around `supabase-js`. Call it directly.
- This is a solo project at ~20h/week. Prefer the boring version.

## Design

Source: Figma Make — "Financial Reporting Portal". Tokens are ported to
`src/app.css`. **Use the tokens, never raw hex.** The Figma export hardcodes
`bg-[#18181B]` on every element; that is an export artifact.

Dark-only. No light theme exists and none is planned.

Five screens in the export, four of them real:

| Screen | Route | Notes |
|---|---|---|
| Dasbor Eksekutif | `/` | KPI cards, contribution bars, alert panel |
| Laporan P&L | `/entities/[id]/periods/[period]` | Read-only statement, MoM comparison |
| Input Laporan | `/entry/[period]` | Editable rows, locked subtotals, sticky totals footer |
| Persetujuan | `/approval` | Queue with expandable review panel |
| ~~Tampilan Mobile~~ | — | Prototype device-frame preview. Not a route. The real app is responsive. |

The export is React; this project is SvelteKit. Port screen by screen —
do not vendor the `src/app/components/ui` directory. It ships 48 shadcn
components plus MUI, react-slick, react-dnd and canvas-confetti; the four
real screens use none of them. Add each component only when a screen needs it.

Layout conventions worth preserving: 214px sidebar, 48px header bars, and a
sticky footer on the entry screen carrying live totals. Numbers are always
right-aligned and tabular.

## Anti-patterns seen in the original prototype

These were real bugs. Don't reintroduce them.

- Labelling month-over-month comparison as "YoY"
- Storing a React component inside a data object (`icon: Truck`) — icons are
  string keys
- `width: ${margin}%` without clamping to 0–100
- Showing consolidated totals without a banner when entities haven't reported
- Calling a hardcoded if/else "AI Executive Advisor"
- Credentials in source code, displayed on the login screen
- Role checks performed client-side

## Skills

Installed separately, not vendored here:

- `ponytail` — laziness ladder before writing code
- `mattpocock/skills` — `/grill-with-docs`, `/tdd`, `/code-review`,
  `/domain-modeling`

Use `/grill-with-docs` before any non-trivial feature. Use `/code-review`
before committing.
