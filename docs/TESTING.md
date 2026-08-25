# End-to-end testing

What is left to check by hand, after `npm test`.

Most of what this file used to hold is now automated — RLS isolation, the
workflow triggers, the data-integrity guards, the audit trail and the number
formatting all live in `tests/`. Run that first:

```sh
npm test
```

Everything below is the remainder: checks that need a rendered page, a real
cookie jar, or a human deciding whether a screen reads correctly.

## What this covers

| Part | Area | Why it stays manual |
|---|---|---|
| [1](#part-1--authentication-and-session) | Login, session, logout, redirect handling | Cookies, redirects and an open-redirect regression. HTTP-level, but outside what the suite drives. |
| [6](#part-6--dashboard-correctness) | Dasbor figures, banners, MoM comparability | Reads rendered HTML. Whether a banner is present and says the right thing is a judgement call. |
| [7](#part-7--layout-responsif-dan-navigasi) | Sidebar rail, mobile drawer, no sideways scroll | Needs a browser you can resize. |

Automated instead, in `tests/`:

| File | Covers | Was |
|---|---|---|
| `rls.test.ts` | Isolation per role, inactive profiles | Part 2 |
| `workflow.test.ts` | Status transitions, segregation of duties, locking | Part 3 |
| `guards.test.ts` | Line codes, period insert, audit immutability | Parts 4–5 |
| `views.test.ts` | View arithmetic, elimination, completeness | Part 4 |
| `format.test.ts` | Rupiah, parentheses, em dash, minus sign | Part 7 |

Two companion files carry the rest:

| File | Covers |
|---|---|
| [`TESTING-WORKFLOW.md`](TESTING-WORKFLOW.md) | The write path — filling a report in, submitting, sending it back, approving, locking, unlocking |
| [`TESTING-PHASE2.md`](TESTING-PHASE2.md) | The read path — Laporan P&L, isolation between entities, and the ILJ import |

## What it does not cover

- **Browser rendering.** Every check below reads server-rendered HTML with
  `curl`. Layout, focus order, and keyboard behaviour need a real browser.
- **Whether the numbers are the client's real numbers.** They are not — see
  the header of `supabase/seed.sql` for exactly which figures are invented.
  This guide tests that the system computes consistently, not that the
  business data is right. Correctness of submitted figures is each entity's
  responsibility (see `CLAUDE.md`).
- **Concurrency.** Two people approving the same period at once is untested.
- **Backup and restore.** The schema's closing note requires a monthly restore
  drill into an empty database. Not covered here.

---

## Setup

Requires Docker Desktop running, the Supabase CLI, and Git Bash (the commands
use POSIX shell, not PowerShell).

```sh
supabase start           # first run pulls images; slow
npm run db:reset         # migrations, then supabase/seed.sql
npm run dev              # http://localhost:5173
```

Re-run `npm run db:reset` before each part. Several checks below mutate data,
and a stale fixture makes the expected values wrong.

Paste this once per shell session. It defines the anon key, a token helper,
and a request helper:

```sh
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

# Log in as one of the seeded roles and print its access token.
tok() {
  curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1@example.test\",\"password\":\"devpassword\"}" \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])"
}

# api <token> <method> <path> [body]
api() {
  local t="$1" m="$2" p="$3" b="${4:-}"
  curl -s -X "$m" "http://127.0.0.1:54321/rest/v1/$p" \
    -H "apikey: $ANON" -H "Authorization: Bearer $t" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    ${b:+-d "$b"}
}

# Run SQL as postgres. Bypasses RLS; triggers still fire.
psql_() { docker exec supabase_db_IMR_keu psql -U postgres -d postgres "$@"; }
```

The anon key is the fixed demo key every local Supabase install gets. It is
not a secret and it is not the key any deployed environment uses.

Tokens survive `npm run db:reset`: the seed pins the account UUIDs and the JWT
signing key comes from the CLI config rather than from data, so a token minted
before a reset still authenticates after one. Handy — but it also means a
browser session stays logged in across a reset, so a stale tab can show you
figures from data that no longer exists. Reload after resetting.

### Accounts

All four use the password `devpassword`. They exist only in a local database
and are never displayed in the UI.

| Email | Role | Reads | Writes |
|---|---|---|---|
| `direksi@example.test` | direksi | everything | everything; only role that can unlock |
| `manajer@example.test` | manajer_keuangan | everything | approves, locks, manages intercompany |
| `staf.ilj@example.test` | staf_entitas | ILJ only | ILJ draft periods only |
| `auditor@example.test` | auditor | everything | nothing |

---

## The fixture

What `npm run db:reset` produces. These are the numbers every expectation
below is written against.

### Entities

| Code | Legal name | Basis | Revenue presentation |
|---|---|---|---|
| ILJ | PT Indra Langgeng Jaya | unknown | unknown |
| AMDK | *(placeholder)* | unknown | unknown |
| TAMBANG | *(placeholder)* | unknown | unknown |
| GARAM | *(placeholder)* | unknown | unknown |

Only ILJ is a confirmed real entity. The other three carry an explicit
`(nama badan hukum belum dikonfirmasi)` label — the prototype's invented PT
names are deliberately not used. All four sit at `unknown` on both policy
columns because A-1 and A-4 are open.

### `v_period_pnl`

| Entity | Period | Status | Revenue | COGS | Opex | Gross | Net | Margin |
|---|---|---|---:|---:|---:|---:|---:|---:|
| ILJ | 2025-06 | approved | 241.500.000 | 210.825.000 | 14.700.000 | 30.675.000 | 15.975.000 | 6,61% |
| ILJ | 2025-07 | approved | 235.000.000 | 222.050.000 | 15.128.807 | 12.950.000 | **−2.178.807** | −0,93% |
| TAMBANG | 2025-07 | approved | 96.400.000 | 73.728.000 | 25.100.000 | 22.672.000 | −2.428.000 | −2,52% |
| AMDK | 2025-07 | **submitted** | 112.750.000 | 68.300.000 | 14.500.000 | 44.450.000 | 29.950.000 | 26,56% |

ILJ's July net of −2.178.807 is the one figure taken from the documented
history. It is the number the 65/35 split was applied to that month
(−1,42jt / −0,76jt), which is the evidence in A-3 that the split is a
distribution and not an expense. **If a change makes this number move, the
change is wrong.**

AMDK is `submitted`, not `approved`, on purpose: it must stay out of
consolidation so the incompleteness path is always exercised.

### `v_group_consolidated`

| Period | Revenue sum | Elimination | Revenue consolidated | Net profit | Complete | Missing |
|---|---:|---:|---:|---:|---|---|
| 2025-06 | 241.500.000 | 0 | 241.500.000 | 15.975.000 | no | AMDK, TAMBANG, GARAM |
| 2025-07 | 331.400.000 | 0 | 331.400.000 | −4.606.807 | no | AMDK, GARAM |

Elimination is 0 because the intercompany registry ships empty (A-5). Neither
period is complete, so the banner should always be visible.

```sh
psql_ -c "select entity_code, period, status, revenue, net_profit from v_period_pnl order by period, entity_code;"
psql_ -c "select * from v_group_consolidated order by period;"
psql_ -c "select * from v_period_completeness order by period;"
```

---

## How to read a refusal

Three different things all mean "blocked", and they look nothing alike. Read
this before concluding a test passed.

| Response | Meaning |
|---|---|
| `{"code":"P0001", "message":"..."}` | A trigger raised. The message is the rule that fired. |
| `{"code":"42501", "message":"...row-level security policy..."}` | An RLS `WITH CHECK` rejected the row. |
| `{"code":"42501", "message":"permission denied for table ..."}` | No `GRANT`. Different bug entirely — the role has no privilege at all. |
| `[]` — empty array, HTTP 200 | **Also blocked.** An RLS `USING` clause matched zero rows, so the UPDATE or DELETE touched nothing. |

That last row is the trap. A `PATCH` that returns `[]` did **not** succeed.
Always re-read the row to confirm what actually happened:

```sh
api "$(tok staf.ilj)" GET "periods?id=eq.<id>&select=status,submitted_by,approved_by"
```

---

## Part 1 — Authentication and session

Run against the dev server on `http://localhost:5173`.

```sh
CJ=$(mktemp)   # cookie jar
login() {
  curl -s -c "$CJ" -X POST "http://localhost:5173/login${2:-}" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -H "x-sveltekit-action: true" \
    --data-urlencode "email=$1@example.test" \
    --data-urlencode "password=${3:-devpassword}"
}
```

### 1.1 Unauthenticated request is redirected, with the target preserved

```sh
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:5173/
```

Expect `303 http://localhost:5173/login?redirectTo=%2F`.

### 1.2 Wrong password is refused, and does not say why

```sh
login manajer "" wrongpassword
```

Expect a `failure` with `Email atau kata sandi tidak sesuai.` — the same
message a nonexistent address gets. If unknown-email and wrong-password ever
produce different messages, the login has become an account-enumeration
oracle.

### 1.3 Correct password issues a session

```sh
login manajer
grep -c "sb-" "$CJ"
```

Expect `{"type":"redirect","status":303,"location":"/"}` and one `sb-` cookie.

### 1.4 The login page leaks no credentials

```sh
curl -s http://localhost:5173/login | grep -ciE "devpassword|example\.test"
```

Expect `0`. The prototype printed working logins on this screen.

### 1.5 `redirectTo` cannot leave the origin

This is the check most worth keeping. A plain `startsWith('/')` test is not
enough: browsers strip tab, LF and CR from a URL before resolving it, so
`/<TAB>/evil.example.com` becomes `//evil.example.com` — a protocol-relative
URL pointing off-site. Backslashes get the same treatment.

```sh
for enc in "%2Fentry%2F2025-07-01" "%2F%3Fperiode%3D2025-06-01" \
           "%2F%2Fevil.example.com" "https%3A%2F%2Fevil.example.com" \
           "%2F%09%2Fevil.example.com" "%2F%0A%2Fevil.example.com" \
           "%2F%5Cevil.example.com" ""; do
  printf "  %-34s -> " "$enc"
  curl -s -X POST "http://localhost:5173/login?redirectTo=$enc" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "email=manajer@example.test" \
    --data-urlencode "password=devpassword" \
  | python -c "import sys,json;print(json.load(sys.stdin).get('location'))"
done
```

| `redirectTo` | Expected location |
|---|---|
| `/entry/2025-07-01` | `/entry/2025-07-01` — same-origin paths are honoured |
| `/?periode=2025-06-01` | `/?periode=2025-06-01` — query preserved |
| `//evil.example.com` | `/` |
| `https://evil.example.com` | `/` |
| `/<TAB>/evil.example.com` | `/` |
| `/<LF>/evil.example.com` | `/` |
| `/\evil.example.com` | `/` |
| *(absent)* | `/` |

Anything other than `/` in the last six rows is an open redirect.

### 1.6 Logout requires POST

```sh
login manajer
curl -s -b "$CJ" -o /dev/null -w "before %{http_code}\n" http://localhost:5173/
curl -s -b "$CJ" -c "$CJ" -X POST http://localhost:5173/logout -o /dev/null -w "logout %{http_code}\n"
curl -s -b "$CJ" -o /dev/null -w "after  %{http_code}\n" http://localhost:5173/
```

Expect `before 200`, `logout 303`, `after 303`. The route defines only `POST`;
a `GET` must never end a session, or any page could log the user out with an
`<img>` tag.

---

## Part 6 — Dashboard correctness

```sh
npm run db:reset
CJ=$(mktemp)
curl -s -c "$CJ" -X POST http://localhost:5173/login \
  -H "Content-Type: application/x-www-form-urlencoded" -H "x-sveltekit-action: true" \
  --data-urlencode "email=manajer@example.test" --data-urlencode "password=devpassword" -o /dev/null

# Strip tags so the rendered text can be read in a terminal.
text() { python -c "
import sys,re,html
s=sys.stdin.read()
s=re.sub(r'(?s)<script.*?</script>','',s); s=re.sub(r'(?s)<style.*?</style>','',s)
s=re.sub(r'<[^>]+>','\n',s); s=html.unescape(s)
print(' | '.join(re.sub(r'\s+',' ',l).strip() for l in s.splitlines() if l.strip()))
"; }

curl -s -b "$CJ" http://localhost:5173/ | text
```

### 6.1 July 2025 — the default period

Expect these strings:

| Element | Expected text |
|---|---|
| Banner | `Data belum lengkap — 2 dari 4 entitas sudah disetujui.` … `Belum masuk: AMDK, GARAM.` |
| Pendapatan Konsolidasi | `Rp 331,4 jt` |
| Laba Bersih Konsolidasi | `(Rp 4,6 jt)` |
| Eliminasi Antar-Perusahaan | `Rp 0` + `Belum ada transaksi antar-perusahaan tercatat` |
| Kelengkapan | `2/4` + `2 belum lapor` |
| Contribution — ILJ | `Rp 235 jt` · `70,9%` |
| Contribution — TAMBANG | `Rp 96,4 jt` · `29,1%` |
| Contribution — AMDK | `Diajukan` · `—` |
| Contribution — GARAM | `belum lapor` · `—` |
| Consolidation table | Pendapatan `331.400.000 / 0 / 331.400.000`; Laba bersih `(4.606.807)` |

The banner is not dismissible and must never be absent while
`is_complete = false`. Showing consolidated totals without it is the
prototype bug this design exists to prevent.

### 6.2 The MoM delta is marked, not coloured, when the entity set changes

Expect `+37,2% MoM` accompanied by `himpunan entitas berbeda dari Juni 2025 —
bukan perubahan kinerja`, in warning colour rather than green.

**Why:** June has one approved entity, July has two. Almost all of that
"+37,2%" is TAMBANG appearing, not revenue growing. A green arrow here says
"the group grew 37%", which is false. This is the same trap as showing a
partial total as final, in a second dimension.

### 6.3 June 2025 — no prior month exists

```sh
curl -s -b "$CJ" "http://localhost:5173/?periode=2025-06-01" | text
```

| Element | Expected |
|---|---|
| Banner | `1 dari 4 entitas sudah disetujui` … `Belum masuk: AMDK, TAMBANG, GARAM.` |
| Pendapatan Konsolidasi | `Rp 241,5 jt` + `Tidak ada pembanding untuk Mei 2025` |
| Laba Bersih Konsolidasi | `Rp 16 jt` + `Tidak ada pembanding untuk Mei 2025` |

No May 2025 period exists, so there is no delta — and the tile says so rather
than rendering `0%` or an empty badge. `Rp 16 jt` is 15.975.000 rounded to one
decimal place; the tile is a summary, and the full figure appears in the
consolidation table.

### 6.4 An unknown period falls back to the newest, not a 404

```sh
curl -s -b "$CJ" "http://localhost:5173/?periode=1999-01-01" | text
```

Expect identical output to 6.1. A stale bookmark should land somewhere
truthful rather than on an error page.

### 6.5 Open policies are surfaced, not defaulted

Expect `5 kebijakan akuntansi belum diputuskan` listing
`revenue_presentation_trucking, uang_saku_treatment, profit_sharing_65_35,
accounting_basis, accounting_standard`, and the comparability warning
`Basis pelaporan sebagian entitas belum ditetapkan, sehingga angka di bawah
ini belum dapat dibandingkan antar entitas.`

**Why:** where a policy is undecided the system shows the hole rather than
filling it with an assumption (invariant 8). If this count ever reaches 0
without a matching entry in `ASSUMPTIONS.md`'s Resolved section, someone
picked a default in code.

### 6.6 Alerts derive only from data that exists

Expect exactly four alerts for July: two losses (ILJ `margin −0,93%`, TAMBANG
`margin −2,52%`), AMDK `Berstatus Diajukan — belum disetujui, jadi tidak masuk
konsolidasi`, and GARAM `Belum ada laporan untuk periode ini`. Plus the open
policies entry.

There is deliberately no "margin below 5%" alert. Nobody has decided that
threshold, and a loss needs no threshold to be a loss. If a magic number
appears in this panel, it came from the prototype, not from a decision.

---

## Part 7 — Layout responsif dan navigasi

Browser-only: `curl` cannot resize anything. Every figure below was measured
in Chrome at that exact viewport width.

The sidebar is the whole story. It used to be a fixed 214px at every width,
which left a 360px phone with 146px of content — the dashboard title rendered
as "Da". It now has three states, described in `CLAUDE.md`.

### 7.1 Desktop — the rail

At 1440px, logged in as anyone:

| # | Action | Expected |
|---|---|---|
| 7.1.1 | Look at the sidebar | 214px, labels visible, "Ciutkan" at its foot |
| 7.1.2 | Press **Ciutkan** | Sidebar narrows to 60px, icons only, content gains 154px |
| 7.1.3 | Hover a collapsed icon | Tooltip gives the label |
| 7.1.4 | Reload the page | **Still collapsed.** The choice is a cookie, so the server renders it that way and nothing jumps |
| 7.1.5 | Press the same button, now **Lebarkan** | Back to 214px |
| 7.1.6 | `document.cookie` | Contains `sidebar=rail` when collapsed, `sidebar=full` when not |

### 7.2 Phone — the drawer

At 390px:

| # | Action | Expected |
|---|---|---|
| 7.2.1 | Load any screen | No sidebar. A 48px bar on top with ☰ and "Portal Keuangan". Content gets the **full 390px** |
| 7.2.2 | Press ☰ | 260px drawer slides over the page, backdrop dims what is behind |
| 7.2.3 | Press the backdrop | Closes |
| 7.2.4 | Press ✕ | Closes |
| 7.2.5 | Press <kbd>Esc</kbd> | Closes |
| 7.2.6 | Open it, then tap a nav item | Navigates **and** closes — a drawer left open over the page you just asked for is a bug |
| 7.2.7 | With the drawer shut, press <kbd>Tab</kbd> repeatedly | Focus never lands inside the sidebar. It is `visibility: hidden`, not just moved off-screen |

### 7.3 No screen scrolls sideways

At 360, 390, 768, 1024 and 1440, on Dasbor, Laporan P&L, Persetujuan, Input
Laporan and the two list screens:

```js
// paste in the console on each screen
document.documentElement.scrollWidth > document.documentElement.clientWidth
```

Expect `false` everywhere. The page itself must never scroll horizontally.

Two tables are **meant** to scroll sideways inside their own box, and that is
not the same thing:

- Laporan P&L's statement — `min-w-[560px]`
- Persetujuan's queue — `min-w-[880px]`, entity column floored at 210px

Six columns of dates and statuses do not fit a phone, and squeezing them turns
every legal name into four lines. Scrolling the box is the honest answer;
scrolling the page is not.

### 7.4 What still needs eyes

| # | Check | Expected |
|---|---|---|
| 7.4.1 | Dasbor at 360px | Banner readable, four KPI cards stacked one per row |
| 7.4.2 | Laporan P&L at 360px | Policy keys **wrap** — `revenue_presentation_trucking` is one unbreakable word and used to run off the side |
| 7.4.3 | Laporan P&L at 360px | Status badge still visible; the duplicate period label beside it is what gives way |
| 7.4.4 | Any screen, 768px | Sidebar returns to 214px and the top bar disappears |

---

## Regression checklist

Run before committing anything that touches the schema or a view.

```sh
npm run db:reset   # applies cleanly, seed included
npm test           # 112 assertions, under 5 seconds
npm run check      # 0 errors, 0 warnings
npm run build      # completes; adapter-auto warns about no platform, expected
```

`npm run db:reset` comes first and is not optional after a schema change: the
suite resets its fixture by truncating and replaying `supabase/seed.sql`, which
is fast but does not re-apply migrations.

One line per invariant in `CLAUDE.md`:

| # | Invariant | Check |
|---|---|---|
| 1 | Authorization is RLS | `tests/rls.test.ts` |
| 2 | No stored subtotals | `tests/views.test.ts`, plus `psql_ -c "\d report_lines"` showing no `gross_profit` / `net_profit` column |
| 3 | `numeric(18,2)`, full Rupiah | `tests/format.test.ts` |
| 4 | Audit trail written by triggers | `tests/guards.test.ts` |
| 5 | Lines mutable only in draft | `tests/workflow.test.ts` |
| 6 | No self-approval | `tests/workflow.test.ts` |
| 7 | Templates are data | `psql_ -c "select count(*) from report_template_lines;"` → 16; no line labels in `src/` |
| 8 | No invented policy | [6.5](#65-open-policies-are-surfaced-not-defaulted), [6.6](#66-alerts-derive-only-from-data-that-exists) |

Two structural checks the suite does not make, because they are about the
schema rather than its behaviour. Every table must have RLS enabled and at
least one policy:

```sh
psql_ -t -A -c "
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r'
  and (c.relrowsecurity = false
       or (select count(*) from pg_policies p
           where p.tablename=c.relname and p.schemaname='public')=0);"
```

Expect no output. Any table listed here is reachable without a policy.

And no table may be missing its grants, which RLS does not provide:

```sh
psql_ -t -A -c "
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','v')
  and not has_table_privilege('authenticated', c.oid, 'SELECT');"
```

Expect no output. A table with policies but no `GRANT` fails every query with
`42501` — policies narrow privileges, they never confer them.
