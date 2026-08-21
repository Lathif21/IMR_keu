# End-to-end testing

Manual end-to-end checks for the portal, run against the local Supabase stack.
Every command and every expected value in this file was executed against a
freshly seeded database — nothing here is written from memory.

There is no test runner installed. This is a checklist, not a suite. See
[If you automate this](#if-you-automate-this) at the end.

## What this covers

The parts of the system where being wrong produces a wrong financial report:

| Part | Area |
|---|---|
| [1](#part-1--authentication-and-session) | Login, session, logout, redirect handling |
| [2](#part-2--rls-who-can-see-what) | RLS isolation per role |
| [3](#part-3--workflow-guards) | Draft-only edits, segregation of duties, status transitions |
| [4](#part-4--data-integrity-guards) | Line codes, completeness, elimination timing |
| [5](#part-5--audit-trail) | Append-only audit log and actor attribution |
| [6](#part-6--dashboard-correctness) | Dasbor figures, banners, MoM comparability |
| [7](#part-7--number-formatting) | Rupiah, parentheses, em dash, minus sign |

## What it does not cover

- **The three unbuilt screens.** Laporan P&L, Input Laporan and Persetujuan do
  not exist yet; their nav items render disabled. Nothing to test.
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

## Part 2 — RLS: who can see what

Authorization lives in RLS, not in application code (invariant 1). These
checks bypass the app entirely and talk to PostgREST, so they test the real
boundary rather than the UI's opinion of it.

### 2.1 Entity staff see one entity

```sh
ST=$(tok staf.ilj)
api "$ST" GET "entities?select=code"
api "$ST" GET "v_period_pnl?select=entity_code,period"
api "$ST" GET "report_lines?select=line_code" | python -c "import sys,json;print(len(json.load(sys.stdin)),'rows')"
api "$ST" GET "audit_log?select=id" | python -c "import sys,json;print(len(json.load(sys.stdin)),'rows')"
```

| Query | Expected |
|---|---|
| `entities` | `[{"code":"ILJ"}]` only |
| `v_period_pnl` | ILJ 2025-06 and ILJ 2025-07 only |
| `report_lines` | `24 rows` (ILJ's two months, 12 lines each) |
| `audit_log` | `0 rows` — the log is for group-wide roles |

### 2.2 Auditor reads everything and writes nothing

```sh
AU=$(tok auditor)
api "$AU" GET "entities?select=code"                 # all four
api "$AU" GET "audit_log?select=id" | python -c "import sys,json;print(len(json.load(sys.stdin)),'rows')"
api "$AU" POST "periods" '{"entity_id":"e0000000-0000-4000-a000-000000000004","period":"2025-09-01","template_id":"11111111-1111-1111-1111-111111111111","status":"draft"}'
```

Expect all four entities, a non-zero audit log, and `42501 ... row-level
security policy for table "periods"` on the write.

To prove the auditor cannot write a *line*, they need a draft period to aim
at — otherwise the draft-only guard fires first and proves nothing:

```sh
MG=$(tok manajer)
PID=$(api "$MG" POST "periods" '{"entity_id":"e0000000-0000-4000-a000-000000000004","period":"2025-08-01","template_id":"11111111-1111-1111-1111-111111111111","status":"draft"}' \
      | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
api "$AU" POST "report_lines" "{\"period_id\":\"$PID\",\"line_code\":\"REV_TAGIHAN\",\"amount\":1}"
```

Expect `42501 ... row-level security policy for table "report_lines"`. Then
`npm run db:reset`.

### 2.3 Nobody gets in without logging in

```sh
curl -s "http://127.0.0.1:54321/rest/v1/entities?select=code" -H "apikey: $ANON"
```

Expect `permission denied for table entities`. The `anon` role is granted
nothing at all — the whole portal requires a session.

### 2.4 The dashboard refuses entity staff rather than showing them a partial group

```sh
login staf.ilj
curl -s -b "$CJ" http://localhost:5173/ | grep -c "Tidak tersedia untuk peran Anda"
```

Expect `1`. A group total read under entity-scoped RLS is not a smaller
version of the real number — it is a different number. The screen must refuse
rather than render one entity's revenue as the group's.

---

## Part 3 — Workflow guards

Invariants 5 and 6. Each of these was a live exploit before the guards were
added, so each one is a regression test with a known failure mode.

Run `npm run db:reset` first.

```sh
ST=$(tok staf.ilj); MG=$(tok manajer)
STAF=a0000000-0000-4000-a000-000000000003
MGR=a0000000-0000-4000-a000-000000000002
ILJ_JUL=d0000000-0000-4000-a000-000000000002
```

### 3.1 A new period cannot be born approved

```sh
api "$ST" POST "periods" '{"entity_id":"e0000000-0000-4000-a000-000000000001","period":"2025-08-01","template_id":"11111111-1111-1111-1111-111111111111","status":"approved"}'
```

Expect `Periode baru harus berstatus draft, bukan approved`.

**Failure mode if this regresses:** the transition guard only runs on UPDATE,
so a direct INSERT skips the entire approval workflow. The period counts
toward completeness with no lines in it, and the dashboard reports 4/4.

### 3.2 Lines are only writable while the period is draft

```sh
api "$ST" POST "report_lines" "{\"period_id\":\"$ILJ_JUL\",\"line_code\":\"OPEX_ATK\",\"amount\":1}"
```

Expect `Baris laporan tidak dapat diubah: periode berstatus approved.
Kembalikan ke draft terlebih dahulu.`

### 3.3 Entity staff cannot un-approve their own period

```sh
api "$ST" PATCH "periods?id=eq.$ILJ_JUL" '{"status":"draft","rejection_note":"iseng"}'
```

Expect `Peran Anda tidak berwenang membatalkan persetujuan periode`.

**Failure mode if this regresses:** reverting to draft removes the entity from
consolidation and reopens `report_lines`. That silently changes the group
total and is not a staff-level action.

### 3.4 A submitter cannot approve their own submission — including by omission

The subtle one. Set up a period the manager both submits and tries to
approve:

```sh
PID=$(api "$MG" POST "periods" '{"entity_id":"e0000000-0000-4000-a000-000000000004","period":"2025-07-01","template_id":"11111111-1111-1111-1111-111111111111","status":"draft"}' \
      | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
api "$MG" PATCH "periods?id=eq.$PID" "{\"status\":\"submitted\",\"submitted_by\":\"$MGR\"}" > /dev/null

api "$MG" PATCH "periods?id=eq.$PID" '{"status":"approved"}'                              # 1
api "$MG" PATCH "periods?id=eq.$PID" "{\"status\":\"approved\",\"approved_by\":\"$MGR\"}"  # 2
api "$MG" PATCH "periods?id=eq.$PID" '{"status":"approved","approved_by":"a0000000-0000-4000-a000-000000000001"}' # 3
```

| Attempt | Expected |
|---|---|
| 1 — `approved_by` omitted | `approved_by harus pengguna yang sedang masuk` |
| 2 — `approved_by` = self | `Pengaju tidak dapat menyetujui submission-nya sendiri` |
| 3 — `approved_by` = someone else | `approved_by harus pengguna yang sedang masuk` |

**Failure mode if this regresses:** attempt 1 is the one that used to work.
`new.approved_by = old.submitted_by` evaluates to NULL, not true, when
`approved_by` is left out — so the comparison never ran and the check silently
passed. Attempt 3 matters separately: without it, the audit trail can be
filled in with a colleague's name.

### 3.5 Every return to draft needs a note

```sh
api "$MG" PATCH "periods?id=eq.$ILJ_JUL" '{"status":"draft"}'
```

Expect `Pengembalian ke draft wajib disertai catatan alasan`. This covers
`approved -> draft` and `locked -> draft`, not just rejection from
`submitted` — reopening an already-approved period needs a written reason more,
not less.

### 3.6 The happy path still works

Guards that block legitimate work are as bad as missing guards.

```sh
npm run db:reset
ST=$(tok staf.ilj); MG=$(tok manajer)
AUG=$(api "$ST" POST "periods" '{"entity_id":"e0000000-0000-4000-a000-000000000001","period":"2025-08-01","template_id":"11111111-1111-1111-1111-111111111111","status":"draft"}' \
      | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
api "$ST" POST "report_lines" "{\"period_id\":\"$AUG\",\"line_code\":\"REV_TAGIHAN\",\"amount\":250000000}" > /dev/null
api "$ST" PATCH "periods?id=eq.$AUG" "{\"status\":\"submitted\",\"submitted_by\":\"$STAF\"}" > /dev/null
api "$MG" PATCH "periods?id=eq.$AUG" "{\"status\":\"approved\",\"approved_by\":\"$MGR\"}" > /dev/null
api "$MG" GET "periods?id=eq.$AUG&select=status,submitted_by,approved_by"
```

Expect `status: approved`, `submitted_by` the staff account, `approved_by` the
manager. Then `npm run db:reset`.

---

## Part 4 — Data integrity guards

### 4.1 A mistyped line code is rejected, not silently dropped

Needs a draft period, since the draft-only guard fires first:

```sh
npm run db:reset
MG=$(tok manajer)
PID=$(api "$MG" POST "periods" '{"entity_id":"e0000000-0000-4000-a000-000000000004","period":"2025-08-01","template_id":"11111111-1111-1111-1111-111111111111","status":"draft"}' \
      | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
api "$MG" POST "report_lines" "{\"period_id\":\"$PID\",\"line_code\":\"REV_TYPO\",\"amount\":999}"
api "$MG" POST "report_lines" "{\"period_id\":\"$PID\",\"line_code\":\"REV_TAGIHAN\",\"amount\":50000000}"
```

Expect `Kode baris REV_TYPO tidak ada (atau tidak aktif) pada template periode
ini` for the first, and a created row for the second.

**Failure mode if this regresses:** `v_period_pnl` sums through a join to
`report_template_lines`. A code with no match joins to NULL and is therefore
excluded from *every* `filter (where tl.section = ...)`. The amount disappears
from revenue, costs and net profit at once, with no error — the statement stays
internally consistent and is wrong. One typo, silently wrong report.

Then `npm run db:reset`.

### 4.2 A deactivated entity leaves both sides of the completeness count

```sh
psql_ -c "update entities set is_active=false where code='TAMBANG';"
psql_ -c "select period, expected_entities, reported_entities, is_complete, missing_entities from v_period_completeness order by period;"
psql_ -c "update entities set is_active=true where code='TAMBANG';"
```

Expect `expected_entities = 3` and `reported_entities = 1` for both periods,
with TAMBANG absent from `missing_entities`.

**Failure mode if this regresses:** if only `expected` is filtered by
`is_active`, a deactivated entity with approved periods still counts as having
reported. `reported` can then exceed `expected`, `is_complete` is false
forever, and the KPI tile renders `-1 belum lapor`.

### 4.3 Elimination waits for both sides

The registry ships empty (A-5), so this needs a transaction created by hand.
Record one where the buyer's period is not approved:

```sh
npm run db:reset
psql_ -c "insert into intercompany_transactions (period, seller_entity_id, buyer_entity_id, amount, description) values ('2025-07-01', 'e0000000-0000-4000-a000-000000000001', 'e0000000-0000-4000-a000-000000000002', 10000000, 'uji A-10');"
psql_ -c "select period, revenue_sum, elimination, revenue_consolidated from v_group_consolidated order by period;"
```

Expect `elimination = 0` for 2025-07: ILJ (seller) is approved but AMDK
(buyer) is only `submitted`, so its revenue was never added to `revenue_sum`
and there is nothing to eliminate against. `revenue_consolidated` stays
331.400.000.

**Failure mode if this regresses:** eliminating unconditionally subtracts
10.000.000 from a sum that never included it, and consolidated revenue comes
out too low. Recorded as A-10 in `ASSUMPTIONS.md`.

Now the control — the elimination must actually *apply* once both sides are
in, or this test would pass just as well with the feature broken:

```sh
psql_ -c "set local request.jwt.claims = '{\"sub\":\"a0000000-0000-4000-a000-000000000002\",\"role\":\"authenticated\"}';
          update periods set status='approved', approved_by='a0000000-0000-4000-a000-000000000002'
          where id='d0000000-0000-4000-a000-000000000004';"
psql_ -c "select period, revenue_sum, elimination, revenue_consolidated from v_group_consolidated order by period;"
```

Expect 2025-07 to become `444.150.000 / 10.000.000 / 434.150.000`: AMDK's
112.750.000 joins the sum, and the intercompany 10.000.000 is now eliminated
from it. The `set local` is needed because the approval triggers resolve
`auth.uid()` — a bare `update` as postgres is refused by `can_approve()`.

Then `npm run db:reset`.

---

## Part 5 — Audit trail

The log is written by database triggers, never by application code
(invariant 4).

### 5.1 The log is append-only, even for the superuser

```sh
psql_ -c "update audit_log set action='TAMPERED' where true;"
psql_ -c "delete from audit_log where true;"
```

Both expect `audit_log bersifat append-only dan tidak dapat diubah atau
dihapus`. This runs as `postgres`, so RLS is not involved — the trigger is
what holds. It cannot be bypassed through Supabase Studio or psql either.

### 5.2 Composite-key tables are logged

```sh
psql_ -c "select table_name, record_pk, action from audit_log where table_name='user_entity_access';"
```

Expect one row with `record_pk` of the form `<user_id>:<entity_id>`.

**Failure mode if this regresses:** `audit_log.record_pk` is NOT NULL, and
`user_entity_access` has no `id` column — its key is `(user_id, entity_id)`. A
version of `audit_row()` that only reads `id` makes `record_pk` NULL, the
INSERT aborts, and the audit trigger takes the whole write down with it. The
table becomes impossible to write to, which means entity staff can never be
granted access to anything. This is what made the very first `db reset` fail.

### 5.3 Actors are attributed

```sh
psql_ -c "select table_name, action, actor_id is not null as has_actor, count(*) from audit_log group by 1,2,3 order by 1,2;"
```

| Table | Action | `has_actor` |
|---|---|---|
| accounting_policies | INSERT | `f` |
| entities | INSERT | `t` |
| periods | INSERT | `t` |
| periods | UPDATE | `t` |
| report_lines | INSERT | `t` |
| user_entity_access | INSERT | `t` |

`accounting_policies` is the one exception and it is correct: those five rows
are seeded by the *migration*, which runs with no JWT. The system created
them, not a user. Everything written by `supabase/seed.sql` runs under an
impersonated JWT, so it goes through the same guards the UI does and produces
a realistic trail.

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

## Part 7 — Number formatting

Conventions from `src/app.css`. All visible in the July dashboard.

| Rule | Correct | Wrong |
|---|---|---|
| Negatives in parentheses | `(4.606.807)` | `-4.606.807` |
| Real minus in percentages | `−0,93%` (U+2212) | `-0,93%` (hyphen) |
| No data is an em dash | `—` | `0`, blank |
| Zero is a figure | `Rp 0` | `—` |
| Indonesian grouping | `331.400.000` | `331,400,000` |
| juta / miliar only in the view layer | `Rp 331,4 jt` | a `revenue_in_millions` column |
| Figures are tabular and right-aligned | — | — |

`—` and `0` mean different things and must never be interchanged: an entity
that has not reported is not an entity that reported zero.

Amounts are `numeric(18,2)` in full Rupiah. To confirm nothing has started
storing millions:

```sh
psql_ -c "select column_name, data_type, numeric_precision, numeric_scale from information_schema.columns where table_name='report_lines' and column_name='amount';"
```

Expect `numeric`, precision 18, scale 2. `double precision` here would be a
defect regardless of how the numbers happen to look.

---

## Regression checklist

One line per invariant in `CLAUDE.md`. Run before committing anything that
touches the schema or a view.

```sh
npm run check      # 0 errors, 0 warnings
npm run build      # completes; adapter-auto warns about no platform, expected
npm run db:reset   # applies cleanly, seed included
```

| # | Invariant | Check |
|---|---|---|
| 1 | Authorization is RLS | [2.1](#21-entity-staff-see-one-entity)–[2.3](#23-nobody-gets-in-without-logging-in) |
| 2 | No stored subtotals | `psql_ -c "\d report_lines"` shows no `gross_profit` / `net_profit` column |
| 3 | `numeric(18,2)`, full Rupiah | [Part 7](#part-7--number-formatting) |
| 4 | Audit trail written by triggers | [5.1](#51-the-log-is-append-only-even-for-the-superuser)–[5.3](#53-actors-are-attributed) |
| 5 | Lines mutable only in draft | [3.2](#32-lines-are-only-writable-while-the-period-is-draft) |
| 6 | No self-approval | [3.4](#34-a-submitter-cannot-approve-their-own-submission--including-by-omission) |
| 7 | Templates are data | `psql_ -c "select count(*) from report_template_lines;"` → 16; no line labels in `src/` |
| 8 | No invented policy | [6.5](#65-open-policies-are-surfaced-not-defaulted), [6.6](#66-alerts-derive-only-from-data-that-exists) |

Every table must also have RLS enabled and at least one policy:

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

---

## If you automate this

Not done, and not free. What it would cost:

- **Parts 2–5** are HTTP and SQL assertions with no browser involved. They are
  the highest value and the cheapest to automate — a `node --test` file plus
  the `tok`/`api` helpers above would cover them, with no new dependency
  beyond what is installed.
- **Parts 1, 6 and 7** read rendered HTML. Automating them properly means
  Playwright, which is a real dependency and a real CI cost. The `text()`
  helper above is enough to assert on server-rendered strings without it,
  which covers most of the value.
- **Isolation** is the actual problem. Every part above mutates the database
  and assumes a fresh seed. `supabase db reset` takes several seconds, so a
  per-test reset is too slow; tests would need to run inside a transaction
  that rolls back, or each own its own period so they cannot collide.

Until then: run the parts you touched, and the [regression
checklist](#regression-checklist) before you commit.
