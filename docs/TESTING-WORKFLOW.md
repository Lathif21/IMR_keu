# End-to-end workflow testing

Companion to [`TESTING.md`](TESTING.md). That file probes one invariant at a
time — can this role read that row, does this trigger fire. This file walks a
report through its whole life across the two write screens: created, filled,
saved, submitted, sent back, fixed, approved, locked, unlocked.

Every command and every expected value below was executed against a freshly
seeded database. Nothing here is written from memory.

Run the automated suite first:

```sh
npm test
```

It covers the database underneath these screens — every status transition,
both self-approval guards, the note requirement, the line-code guard, audit
attribution and the number parser. What is left here is the part that has to go
through the screens themselves: that the form actions exist, that a refusal
reaches the user as a readable Indonesian sentence rather than a Postgres
error, and that the page comes back showing the right state.

## What this covers

| Part | Area |
|---|---|
| [Journey 1](#journey-1--an-entity-files-a-report) | `/entry` → `/entry/[period]`: create, fill, save, submit |
| [Journey 2](#journey-2--the-reviewer-sends-it-back) | `/approval`: reject with a note, staff fixes, approve |
| [Journey 3](#journey-3--lock-and-unlock) | Lock, refuse the unlock, unlock as direksi |
| [Part D](#part-d--how-an-amount-is-parsed) | That the posted value reaches the column intact |
| [Part E](#part-e--what-the-entry-screen-refuses) | Fake line codes, overflow, cross-entity, duplicates |
| [Part F](#part-f--what-the-approval-screen-refuses) | Both self-approval paths, wrong role, silent refusals |
| [Part G](#part-g--access-matrix) | Every role against every new route |
| [Part H](#part-h--audit-trail-across-a-journey) | The journey, in order, with a name on every step |
| [Part I](#part-i--browser-only-checks) | What `curl` cannot see |

Parts E, F and H overlap the suite on purpose: the suite proves the trigger
fires, and these prove the screen shows the person what it said.

## What it does not cover

- **Anything `npm test` already asserts** about the database in isolation.
  Trigger and policy behaviour lives in `tests/`; this file only checks how
  the two write screens present it.
- **Anything in `TESTING.md`.** Session handling and dashboard figures live
  there. Run both.
- **Browser behaviour**, except as listed in [Part I](#part-i--browser-only-checks).
  Everything else reads server-rendered HTML with `curl`.
- **Concurrency.** Two reviewers acting on one period at the same time is
  still untested, and still deferred — four entities, one manager.
- **Whether the figures are the client's real figures.** They are not. See the
  header of `supabase/seed.sql`.

---

## Setup

Start from a clean fixture. Several journeys mutate it, and a stale one makes
the expected values wrong.

```sh
npm run db:reset
npm run dev              # http://localhost:5173
```

`TESTING.md`'s [Setup](TESTING.md#setup) block still applies — `ANON`, `tok`,
`api`, `psql_`. These screens are driven through forms rather than PostgREST,
so paste this as well:

```sh
APP="${APP:-http://localhost:5173}"     # override if Vite picked another port
JARS="${JARS:-/tmp}"

# Log in and keep the session cookie. One jar per role.
login() {
  curl -s -c "$JARS/cj.$1" -o /dev/null -X POST "$APP/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "email=$1@example.test" --data-urlencode "password=devpassword"
}

# post <user> <path?/action> [--data-urlencode k=v ...]
post() { local u="$1" p="$2"; shift 2
  curl -s -b "$JARS/cj.$u" -X POST "$APP$p" \
    -H "Content-Type: application/x-www-form-urlencoded" "$@"; }

get()  { curl -s -b "$JARS/cj.$1" "$APP$2"; }
code() { curl -s -b "$JARS/cj.$1" -o /dev/null -w '%{http_code} %{redirect_url}\n' "$APP$2"; }

# Rendered text, scripts stripped — the hydration payload is not the page.
text() { python -c "
import sys,re
h=sys.stdin.read()
h=re.sub(r'<script[\s\S]*?</script>',' ',h)
print(re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',h)))
"; }

# field amount  ->  REV_TAGIHAN = 248.000.000
field() { python -c "
import sys,re
h=sys.stdin.read()
for m in re.finditer(r'name=\"$1__([A-Z_]+)\"[^>]*?value=\"([^\"]*)\"',h): print(m.group(1),'=',m.group(2))
"; }

for u in staf.ilj manajer direksi auditor; do login $u; done
```

`text()` strips `<script>` on purpose. SvelteKit serialises the whole `load`
return into the page for hydration, so an entity name can appear in the source
without ever being rendered. Asserting on raw HTML will tell you a screen
leaked something it did not.

### Reading an action's response

A form action answers in one of two shapes depending on what the client asked
for, and both are correct:

```sh
# What a browser with JavaScript sends — enhanced submission, JSON envelope.
post staf.ilj "/entry?/createPeriod" --data-urlencode "bulan=2025-09" --data-urlencode "entitas=ILJ"
#  {"type":"redirect","status":303,"location":"/entry/2025-09?entitas=ILJ"}   [HTTP 200]

# What a browser without JavaScript sends — a real 303.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST "$APP/entry?/createPeriod" \
  -H "Accept: text/html" -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "bulan=2025-09" --data-urlencode "entitas=ILJ"
#  303  .../entry/2025-09?entitas=ILJ
```

`curl` defaults to `Accept: */*`, which negotiates the JSON envelope. **HTTP
200 with `"type":"failure"` inside is a refusal, not a success** — the status
line describes the transport, the envelope describes the outcome. This is the
form-action equivalent of the `[]` trap in
[TESTING.md's refusal table](TESTING.md#how-to-read-a-refusal).

Both paths matter. The no-JS one is not a curiosity: the entry form posts real
figures, and it has to work when a script fails to load.

---

## Journey 1 — an entity files a report

ILJ's last seeded period is July 2025, so the entry screen offers August.
Run on a fresh `npm run db:reset`.

### 1.1 The list page offers the right month

```sh
get staf.ilj "/entry" | grep -o 'name="bulan"[^>]*value="[^"]*"'
```

Expect `value="2025-08"` — the month after the newest period, whatever its
status. With no periods at all it would be the current month in Jakarta.

The two seeded periods appear as **Disetujui** with a **Lihat** link, not
**Isi**: only a draft is fillable.

### 1.2 Create it

```sh
post staf.ilj "/entry?/createPeriod" \
  --data-urlencode "bulan=2025-08" --data-urlencode "entitas=ILJ"
```

Expect a redirect to `/entry/2025-08?entitas=ILJ`.

```sh
psql_ -qAt -c "select status, created_by from periods where period='2025-08-01'
               and entity_id='e0000000-0000-4000-a000-000000000001';"
```

Expect `draft|a0000000-0000-4000-a000-000000000003`. The client sends neither
`status` nor `created_by`: `guard_period_insert` forces draft and takes the
creator from `auth.uid()`. Anything else here means the trigger was bypassed.

### 1.3 The empty form inserts nothing

```sh
get staf.ilj "/entry/2025-08?entitas=ILJ" | field amount
psql_ -qAt -c "select count(*) from report_lines where period_id=(select id from periods
               where period='2025-08-01' and entity_id='e0000000-0000-4000-a000-000000000001');"
```

Expect all 16 template lines at `0`, and a count of **0**. Opening a period
must not create rows — that would write 16 `audit_log` entries for a page view
and stamp `updated_at` on a report nobody touched.

There is no **Kode Akun** column:

```sh
get staf.ilj "/entry/2025-08?entitas=ILJ" | text | grep -c "Kode Akun"
```

Expect `0`. The Figma export shows `4-001`, `5-001`; no chart of accounts has
been agreed (A-7) and `account_code` is empty. Showing codes that will change
teaches people a number that is going to be wrong.

### 1.4 Fill it and save the draft

```sh
post staf.ilj "/entry/2025-08?/saveDraft" \
  --data-urlencode "entitas=ILJ" \
  --data-urlencode "amount__REV_TAGIHAN=248.000.000" \
  --data-urlencode "amount__COGS_PAJAK=4.960.000" \
  --data-urlencode "amount__COGS_REKANAN=205.840.000" \
  --data-urlencode "note__COGS_REKANAN=83% dari tagihan" \
  --data-urlencode "amount__COGS_TERPAL=1.500.000" \
  --data-urlencode "amount__COGS_OPS=4.200.000" \
  --data-urlencode "amount__COGS_SAKU=0" \
  --data-urlencode "note__COGS_SAKU=nihil; perlakuan belum diputuskan (A-2)" \
  --data-urlencode "amount__OPEX_GAJI=9.500.000" \
  --data-urlencode "amount__OPEX_SEWA=1.500.000" \
  --data-urlencode "amount__OPEX_ATK=680.000" \
  --data-urlencode "amount__OPEX_PROF=0"
```

Expect `{"type":"success",...,"saved":...}`.

```sh
psql_ -qAt -c "select line_code, amount, coalesce(note,'-') from report_lines
  where period_id=(select id from periods where period='2025-08-01'
    and entity_id='e0000000-0000-4000-a000-000000000001') order by line_code;"
```

Expect exactly nine rows:

```
COGS_OPS|4200000.00|-
COGS_PAJAK|4960000.00|-
COGS_REKANAN|205840000.00|83% dari tagihan
COGS_SAKU|0.00|nihil; perlakuan belum diputuskan (A-2)
COGS_TERPAL|1500000.00|-
OPEX_ATK|680000.00|-
OPEX_GAJI|9500000.00|-
OPEX_SEWA|1500000.00|-
REV_TAGIHAN|248000000.00|-
```

Three things to read in that list:

- **`OPEX_PROF` is absent.** Zero with no note is deleted, not stored.
- **`COGS_SAKU` is present at 0.** Zero *with* a note is a statement, and it is
  kept. This is the A-2 gap being recorded rather than papered over.
- **`205840000.00`, not `20584000000`.** The posted value was
  `205.840.000` — dots are thousands separators and were dropped, not treated
  as decimals. See [Part D](#part-d--how-an-amount-is-parsed).

### 1.5 The draft survives a reload, in full Rupiah

```sh
get staf.ilj "/entry/2025-08?entitas=ILJ" | field amount
get staf.ilj "/entry/2025-08?entitas=ILJ" | field note
```

Expect `REV_TAGIHAN = 248.000.000`, `COGS_REKANAN = 205.840.000`, the untouched
lines at `0`, and both notes back verbatim. Grouped with dots, no `jt`, no `M`
— shortening happens only on the dashboard's KPI tiles.

### 1.6 The footer reconciles with `v_period_pnl`

This is the check that matters most on this screen. The subtotals and the
footer are computed in the browser from unsaved values; the view recomputes
from stored rows. They must agree, or a staff member is looking at a net profit
that will change the moment they save.

```sh
get staf.ilj "/entry/2025-08?entitas=ILJ" | text \
  | grep -o "Total Pendapatan Rp [0-9.]* Total Beban Rp [0-9.]* Laba Bersih Rp [0-9.]*"

psql_ -qAt -c "select revenue, cogs, opex, gross_profit, net_profit, net_margin_pct
               from v_period_pnl where period='2025-08-01' and entity_code='ILJ';"
```

| Screen | Value | `v_period_pnl` |
|---|---:|---|
| Total Pendapatan | `Rp 248.000.000` | `revenue` 248000000.00 |
| Total Beban | `Rp 228.180.000` | `cogs` 216500000.00 + `opex` 11680000.00 |
| Laba Bersih | `Rp 19.820.000` | `net_profit` 19820000.00 |

Section subtotal rows carry the same figures: Total Pendapatan `248.000.000`,
Total Beban Pokok Pendapatan `216.500.000`, Total Beban Usaha `11.680.000`.

Note that **Total Pendapatan includes Pendapatan Lain-lain and Total Beban
includes Pajak Penghasilan** — the footer buckets follow the same signs as
`v_period_pnl.net_profit`, so the three tiles always reconcile. Hover a tile in
a browser to see which sections it sums.

None of these subtotals is stored:

```sh
psql_ -c "\d report_lines" | grep -Ei "gross|net|subtotal|total"
```

Expect no output (invariant 2).

### 1.7 Submit

```sh
post staf.ilj "/entry/2025-08?/submit" --data-urlencode "entitas=ILJ"
```

Expect a redirect to `/entry?entitas=ILJ&terkirim=2025-08`, and `/entry` then
shows a green banner naming Agustus 2025.

```sh
psql_ -qAt -c "select status, submitted_by, submitted_at is not null, approved_by
  from periods where period='2025-08-01' and entity_id='e0000000-0000-4000-a000-000000000001';"
```

Expect `submitted | a0000000-0000-4000-a000-000000000003 | t |` — a submitter,
no approver. `submitted_by` must be populated in the same UPDATE as the status:
the approval screen reads it to enforce segregation of duties, and a submitted
period with a NULL submitter is exactly the hole that check used to have.

Submitting also saves whatever is on screen first, so posting amounts along
with `?/submit` persists them before the transition. That is deliberate — the
lines stop being writable the moment the status changes.

### 1.8 A submitted period is read-only

```sh
get staf.ilj "/entry/2025-08?entitas=ILJ" | grep -c 'name="amount__'
get staf.ilj "/entry/2025-08?entitas=ILJ" | grep -c 'Simpan Draft'
```

Expect `0` and `0`: values render as text, and there is no button to save. The
figures are still visible — read-only, not hidden.

---

## Journey 2 — the reviewer sends it back

Continues directly from Journey 1.

### 2.1 The queue shows every entity

```sh
get manajer "/approval?periode=2025-08" | text
```

For August, only ILJ has a period. Expect four rows in this order:

| # | Entity | Status |
|---|---|---|
| 0 | PT Indra Langgeng Jaya | Diajukan |
| 1 | *(placeholder)* — lini AMDK | Belum dibuat |
| 2 | *(placeholder)* — lini garam | Belum dibuat |
| 3 | *(placeholder)* — lini tambang | Belum dibuat |

`submitted` sorts first because it is the only row with work attached; the rest
fall back to entity code. **Belum dibuat is a rendered status, not an omission**
— the prototype dropped entities with no period, which made a partial queue
look finished.

The banner reads `0 dari 4 entitas sudah disetujui — …`, amber. Nothing is
approved for August yet.

### 2.2 The review panel

```sh
ILJ_JUL=d0000000-0000-4000-a000-000000000002
get manajer "/approval?periode=2025-07&buka=$ILJ_JUL" | text
```

July is the interesting month — it has a prior month to compare against.
Expect:

```
Perbandingan Juli 2025 vs. Juni 2025 — PT Indra Langgeng Jaya
```

| Pos | Juli 2025 | Juni 2025 | Δ MoM |
|---|---:|---:|---:|
| Pendapatan | 235.000.000 | 241.500.000 | −2,7% |
| Beban Pokok | 222.050.000 | 210.825.000 | +5,3% |
| Laba Kotor | 12.950.000 | 30.675.000 | −57,8% |
| Beban Usaha | 15.128.807 | 14.700.000 | +2,9% |
| Laba Bersih | **(2.178.807)** | 15.975.000 | −113,6% |
| Margin Bersih | −0,93% | 6,61% | **−7,54 pp** |

Four things this table has to get right:

- **`(2.178.807)`** — ILJ's documented July result, in parentheses. If this
  number moves, the change is wrong (`TESTING.md`, the fixture).
- **`Δ MoM`, never YoY.** The prototype labelled month-over-month as
  year-over-year. The header says MoM and the column is the previous calendar
  month.
- **−113,6% is correct.** Going from +15.975.000 to −2.178.807 divides by
  `abs(prior)`, so the sign describes the direction of the change and not the
  sign of the base.
- **Margin Bersih is in points, not percent.** 6,61% → −0,93% is a move of
  −7,54 points. Rendering it as a percentage of a percentage (the prototype's
  "+70,5%") is the kind of number a reviewer talks themselves into approving.

The panel header carries two amber chips, `Basis belum ditetapkan` and
`Penyajian omset belum ditetapkan`. Both entities' policy columns are
`unknown` (A-1, A-4), and a reviewer needs to know that *before* they sign.

The open panel lives in the URL (`?buka=<period_id>`), so it survives an
action, a reload and a shared link, and it works with JavaScript off.

### 2.3 Rejection without a note is refused

```sh
AUG=$(psql_ -qAt -c "select id from periods where period='2025-08-01'
                     and entity_id='e0000000-0000-4000-a000-000000000001';")

post manajer "/approval?/reject" --data-urlencode "periodId=$AUG" --data-urlencode "note=   "
```

Expect `Pengembalian ke draft wajib disertai catatan alasan`, and the status
unchanged at `submitted`. Whitespace is not a note — the trigger trims.

The message is the trigger's own. It is in Indonesian and written for the
person reading the screen, so it passes through verbatim; only `P0001` errors
do. Anything else would be naming tables and policies at a browser.

### 2.4 Rejection with a note returns it to draft

```sh
post manajer "/approval?/reject" --data-urlencode "periodId=$AUG" \
  --data-urlencode "note=Bagian Rekanan 83% belum ada rincian per rekanan. Lampirkan sebelum diajukan lagi."

psql_ -qAt -c "select status, rejection_note from periods where id='$AUG';"
```

Expect `draft` and the note stored.

### 2.5 The staff member sees why

The point of the note. Without this step, rejection is a period that silently
went backwards.

```sh
get staf.ilj "/entry/2025-08?entitas=ILJ" | text | grep -o "Dikembalikan ke draft:.*"
```

Expect the note, in a red banner above the form, with the form editable again:

```sh
get staf.ilj "/entry/2025-08?entitas=ILJ" | grep -c 'bg-destructive/10 border-b border-destructive/25'
get staf.ilj "/entry/2025-08?entitas=ILJ" | grep -c 'name="amount__'
```

Expect `1` and `16`.

### 2.6 Fixed, resubmitted, approved

```sh
post staf.ilj "/entry/2025-08?/submit" --data-urlencode "entitas=ILJ" \
  --data-urlencode "amount__REV_TAGIHAN=248.000.000" \
  --data-urlencode "amount__COGS_REKANAN=205.840.000" \
  --data-urlencode "note__COGS_REKANAN=Rincian per rekanan dilampirkan"

post manajer "/approval?periode=2025-08&/approve" --data-urlencode "periodId=$AUG"
psql_ -qAt -c "select status, approved_by from periods where id='$AUG';"
```

Expect `approved | a0000000-0000-4000-a000-000000000002` — approved by the
manager, submitted by the staff account. Two different people, which is the
whole point of invariant 6.

### 2.7 An approved entity enters consolidation

```sh
psql_ -qAt -c "select revenue_consolidated, net_profit_consolidated, is_complete,
               missing_entities from v_group_consolidated where period='2025-08-01';"
```

Expect `248000000.00 | 19820000.00 | f | {AMDK,TAMBANG,GARAM}`.

The figure the reviewer approved is now the group figure — and it is still
marked incomplete, because three entities have not reported. A consolidated
number computed while entities are missing is a different number, not a smaller
one.

For the same effect from the seed's own fixture, approve AMDK's July period and
watch the dashboard move from `Rp 331,4 jt` / 2 of 4 to `Rp 444.150.000` / 3 of
4.

---

## Journey 3 — lock and unlock

Continues from Journey 2, with August approved.

### 3.1 Lock

```sh
post manajer "/approval?periode=2025-08&/lock" --data-urlencode "periodId=$AUG"
psql_ -qAt -c "select status, locked_by, locked_at is not null from periods where id='$AUG';"
```

Expect `locked`, the manager, and a timestamp. In a browser this asks for
confirmation first — after locking, only direksi can reopen it.

Locking from anything but `approved` is refused:

```sh
post manajer "/approval?/lock" --data-urlencode "periodId=d0000000-0000-4000-a000-000000000004"
#  Transisi status tidak sah: submitted -> locked
```

### 3.2 A locked period refuses line changes

```sh
post staf.ilj "/entry/2025-08?/saveDraft" \
  --data-urlencode "entitas=ILJ" --data-urlencode "amount__OPEX_ATK=1"
```

Expect `Baris laporan tidak dapat diubah: periode berstatus locked. Kembalikan
ke draft terlebih dahulu.` This is `guard_period_editable`, not an application
check — the entry screen sends the write and reports what the database says.

### 3.3 Only direksi can unlock

```sh
post manajer "/approval?periode=2025-08&/unlock" \
  --data-urlencode "periodId=$AUG" --data-urlencode "note=coba"
#  Hanya direksi yang dapat membuka periode yang sudah dikunci
```

The button is not rendered for a manager either:

```sh
get manajer  "/approval?periode=2025-08" | grep -o "Buka Kunci" | wc -l   # 0
get direksi  "/approval?periode=2025-08" | grep -o "Buka Kunci" | wc -l   # 1
```

Both checks matter. A hidden button is not enforcement, and an enforced rule
with a visible button is a screen that invites a refusal.

### 3.4 Unlocking needs a reason

```sh
post direksi "/approval?periode=2025-08&/unlock" --data-urlencode "periodId=$AUG" --data-urlencode "note="
#  Pengembalian ke draft wajib disertai catatan alasan
```

`guard_period_transition` requires a note on **every** return to draft, not
only on rejection from `submitted`. Reopening a period that was declared final
needs a written reason more, not less. The panel's textarea is shared between
rejecting and unlocking for exactly this reason.

```sh
post direksi "/approval?periode=2025-08&/unlock" --data-urlencode "periodId=$AUG" \
  --data-urlencode "note=Koreksi PPh 23 salah periode."
psql_ -qAt -c "select status, rejection_note from periods where id='$AUG';"
```

Expect `draft` and the reason stored.

### 3.5 Unlocking removes it from consolidation and reopens the lines

```sh
psql_ -qAt -c "select count(*) from v_group_consolidated where period='2025-08-01';"   # 0

post staf.ilj "/entry/2025-08?/saveDraft" \
  --data-urlencode "entitas=ILJ" --data-urlencode "amount__OPEX_ATK=700.000"
psql_ -qAt -c "select amount from report_lines where line_code='OPEX_ATK' and period_id='$AUG';"
```

Expect `0` rows in the consolidation and `700000.00` stored. August has no
approved or locked period any more, so it drops out of the group figure
entirely — the round trip is closed.

---

## Part D — how an amount is parsed

The parser itself — every separator, the dropped decimal, the accounting
parentheses, the empty-means-zero rule — is `tests/format.test.ts`. Eleven
inputs, asserted in milliseconds, no database involved.

What stays here is the one thing that file cannot see: that the value the
action parses is the value the column receives.

```sh
post staf.ilj "/entry/2025-08?/saveDraft"   --data-urlencode "entitas=ILJ" --data-urlencode "amount__OTH_INCOME=1.500.000,00" >/dev/null

psql_ -qAt -c "select amount::bigint from report_lines
               where line_code='OTH_INCOME' and period_id='$AUG';"
```

Expect `1500000`.

If it ever reads `150000000`, stop and fix that before anything else: stripping
every non-digit turns `1.500.000,00` into a hundredfold overstatement that
still looks like a plausible figure. `tests/format.test.ts` guards the parser;
this line guards the wiring between the form field and the column.

---

## Part E — what the entry screen refuses

Each of these must produce a readable Indonesian sentence, not a Postgres
error and not a silent no-op.

### E.1 A mistyped line code

```sh
post staf.ilj "/entry/2025-08?/saveDraft" \
  --data-urlencode "entitas=ILJ" --data-urlencode "amount__REV_TYPO=999"
#  Kode baris REV_TYPO tidak ada (atau tidak aktif) pada template periode ini
```

The posted codes are sent to the database as they arrive rather than filtered
against the template first. `guard_line_code_in_template` is the authority, and
its refusal names the code. Filtering in the action would drop a bad code
silently — which is the failure the trigger exists to prevent, moved up a
layer. A code with no template line produces a NULL section in `v_period_pnl`
and vanishes from revenue, expenses and net profit at once, leaving a report
that still balances and is still wrong.

### E.2 A number too large for the column

```sh
post staf.ilj "/entry/2025-08?/saveDraft" \
  --data-urlencode "entitas=ILJ" --data-urlencode "amount__REV_TAGIHAN=99999999999999999"
#  Nominal 100.000.000.000.000.000 pada REV_TAGIHAN terlalu besar untuk disimpan.
```

Checked in the action, because past `numeric(18,2)` Postgres answers `22003`
with a message that names the column rather than the field.

### E.3 Another entity's data

ILJ staff asking for AMDK get their own entity back:

```sh
get staf.ilj "/entry?entitas=AMDK"           | text | grep -c "lini AMDK"     # 0
get staf.ilj "/entry/2025-07?entitas=AMDK"   | text | grep -c "112.750.000"   # 0
get staf.ilj "/entry/2025-07?entitas=AMDK"   | text | grep -c "235.000.000"   # >0
```

The header reads `PT Indra Langgeng Jaya`. `?entitas=` only *picks* from the
list built out of `user_entity_access`, so an unknown or forged value falls
through to the default rather than reaching a query. RLS would refuse the other
entity anyway, but it would refuse it with "permission denied for table
periods", which reads like a broken app rather than a boundary working.

`/entry/2025-07` returning 200 here is correct: ILJ has its own July period.
Check the figures, not the status code.

### E.4 A duplicate period

```sh
post staf.ilj "/entry?/createPeriod" --data-urlencode "bulan=2025-08" --data-urlencode "entitas=ILJ"
#  Periode Agustus 2025 sudah ada untuk ILJ.
```

`23505` names the unique index, which tells the user nothing.

### E.5 A period with no template

Not reproducible from the seed — every entity's `business_line` has an active
`TRUCKING_V1`-shaped template. To exercise it, deactivate one and try:

```sh
psql_ -c "update report_templates set is_active=false where code='TRUCKING_V1';"
post staf.ilj "/entry?/createPeriod" --data-urlencode "bulan=2025-12" --data-urlencode "entitas=ILJ"
#  Belum ada template laporan untuk lini usaha ini.
psql_ -c "update report_templates set is_active=true where code='TRUCKING_V1';"
```

A period created without a template can never be filled in — every line would
be refused by `guard_line_code_in_template`.

### E.6 A stale tab whose period moved on

The subtle one. A period that leaves `draft` between page load and save:

```sh
# with 2025-08 submitted or locked
post staf.ilj "/entry/2025-08?/saveDraft" \
  --data-urlencode "entitas=ILJ" --data-urlencode "amount__OPEX_ATK=0"
#  Periode ini sudah berstatus submitted dan barisnya tidak dapat diubah. …
```

Clearing a line to zero is a DELETE, and a DELETE the RLS `USING` clause
refuses touches zero rows and reports success. Without the status re-read after
writing, this request would tell the user their edit was saved while nothing
changed. Confirm the row really did not move:

```sh
psql_ -qAt -c "select amount from report_lines where line_code='OPEX_ATK' and period_id='$AUG';"
```

---

## Part F — what the approval screen refuses

### F.1 A submitter cannot approve their own submission

Both halves, because one is UI and one is enforcement.

```sh
# The manager creates and submits a period, then meets their own submission.
MG=$(tok manajer); MGR=a0000000-0000-4000-a000-000000000002
PID=$(api "$MG" POST "periods" '{"entity_id":"e0000000-0000-4000-a000-000000000004",
  "period":"2025-07-01","template_id":"11111111-1111-1111-1111-111111111111"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
api "$MG" PATCH "periods?id=eq.$PID" "{\"status\":\"submitted\",\"submitted_by\":\"$MGR\"}" >/dev/null

get manajer "/approval?periode=2025-07" | text | grep -o "Anda pengajunya"
post manajer "/approval?/approve" --data-urlencode "periodId=$PID"
```

Expect the button replaced by `Anda pengajunya`, and the forced POST refused
with `Pengaju tidak dapat menyetujui submission-nya sendiri`. The status must
still be `submitted`.

### F.2 A role that cannot approve

Entity staff can reach an action endpoint even though `load` redirects them —
actions do not run the page's guard. RLS lets the UPDATE through for their own
entity, and the trigger stops it:

```sh
# on an ILJ period someone else submitted
post staf.ilj "/approval?/approve" --data-urlencode "periodId=$AUG"
#  Peran Anda tidak berwenang menyetujui atau mengunci periode
post staf.ilj "/approval?/lock" --data-urlencode "periodId=$AUG"
#  Transisi status tidak sah: submitted -> locked
```

On a period they submitted themselves, F.1's message fires first. Either way it
is refused — the two guards overlap on purpose.

### F.3 An auditor changes nothing

```sh
get auditor "/approval" | text | grep -o "Hanya baca[^A-Z]*"
get auditor "/approval" | text | grep -c -E "Setujui|Kunci"      # 0

post auditor "/approval?/approve" --data-urlencode "periodId=d0000000-0000-4000-a000-000000000004"
post auditor "/approval?/reject"  --data-urlencode "periodId=d0000000-0000-4000-a000-000000000004" \
  --data-urlencode "note=x"
```

Expect the read-only notice, no buttons, and both POSTs answered with HTTP 403
and `Perubahan ini ditolak untuk akun Anda…`.

That message is worth understanding. `periods_update` excludes
`is_readonly_role()`, so the auditor's UPDATE matches **zero rows and raises no
error** — the trigger never even runs. The action reads the result back and
refuses; without that read-back an auditor would be told their approval
succeeded. Confirm the row:

```sh
psql_ -qAt -c "select status from periods where id='d0000000-0000-4000-a000-000000000004';"
#  submitted
```

---

## Part G — access matrix

```sh
ILJ=$(psql_ -qAt -c "select id from entities where code='ILJ';")
TAM=$(psql_ -qAt -c "select id from entities where code='TAMBANG';")

for u in staf.ilj manajer direksi auditor; do
  printf '%-10s /entry:%-22s /approval:%-4s /entities:%-4s own:%-4s other:%s\n' "$u" \
    "$(code $u /entry)" "$(code $u /approval)" "$(code $u /entities)" \
    "$(code $u /entities/$ILJ/periods/2025-07)" \
    "$(code $u /entities/$TAM/periods/2025-07)"
done
```

| Role | `/entry` | `/entry/2025-07` | `/approval` | `/entities` | ILJ P&L | TAMBANG P&L | Nav items shown |
|---|---|---|---|---|---|---|---|
| `staf_entitas` | 200 | 200 | **303 → `/`** | 200 *(one card)* | 200 | **404** | Laporan P&L, Input Laporan |
| `manajer_keuangan` | 200 *(refusal panel)* | **403** | 200 | 200 | 200 | 200 | Dasbor, Laporan P&L, Persetujuan |
| `direksi` | 200 *(refusal panel)* | **403** | 200 | 200 | 200 | 200 | Dasbor, Laporan P&L, Persetujuan |
| `auditor` | 200 *(refusal panel)* | **403** | 200 *(read-only)* | 200 | 200 | 200 | Dasbor, Laporan P&L |

The P&L screen has no role check of its own — RLS decides, and an entity the
caller may not read comes back as zero rows. That has to be a **404**, not an
empty page: an empty page tells a staff member the report is missing when it
is only invisible to them. `/entities` needs no such handling; the staff card
list simply has one entry, which is correct and needs no explanation on screen.

The P&L page carries no form and no button except the sidebar's logout, for
every role including direksi. It is read-only by construction, not by a
disabled attribute:

```sh
get auditor "/entities/$ILJ/periods/2025-07" | grep -o '<form[^>]*action="[^"]*"'
#  <form method="POST" action="/logout"
```

A malformed entity id or month is a 404 too, not a 500 describing a failed
type cast:

```sh
code auditor /entities/not-a-uuid/periods/2025-07   #  404
code auditor "/entities/$ILJ/periods/2025-13"       #  404
code auditor "/entities/$ILJ/periods/2020-01"       #  404  — no such period
```

Unauthenticated, every one of them redirects with the target preserved:

```sh
for p in /entry /entry/2025-07 /approval /entities "/entities/$ILJ/periods/2025-07"; do
  curl -s -o /dev/null -w "$p  %{http_code} %{redirect_url}\n" "$APP$p"
done
#  /entry           303  …/login?redirectTo=%2Fentry
#  /entry/2025-07   303  …/login?redirectTo=%2Fentry%2F2025-07
#  /approval        303  …/login?redirectTo=%2Fapproval
#  /entities        303  …/login?redirectTo=%2Fentities
#  /entities/…      303  …/login?redirectTo=%2Fentities%2F…%2Fperiods%2F2025-07
```

Two asymmetries in that table are intentional, and one is a gap — see
[Known gaps](#known-gaps).

---

## Part H — audit trail across a journey

That the trail is append-only, and that each write carries an `actor_id`, is
`tests/guards.test.ts`. What that cannot show is the shape of a whole journey
across the two screens, in order, with a name against every step.

Run Journeys 1–3 end to end, then:

```sh
psql_ -qAt -c "select coalesce(p.full_name,'(none)') || ' : ' ||
    (a.old_value->>'status') || ' -> ' || (a.new_value->>'status')
  from audit_log a left join profiles p on p.id = a.actor_id
  where a.table_name='periods' and a.action='UPDATE' and a.record_pk='$AUG'
    and (a.old_value->>'status') is distinct from (a.new_value->>'status')
  order by a.occurred_at;"
```

Expect exactly this, in this order:

```
Akun Dev C : draft -> submitted
Akun Dev B : submitted -> draft
Akun Dev C : draft -> submitted
Akun Dev B : submitted -> approved
Akun Dev B : approved -> locked
Akun Dev A : locked -> draft
```

A missing line means a transition happened without being recorded. A `(none)`
means a write reached the database outside a user session — a service-role key
in application code, or a migration doing data work. Both are defects.

---

## Part I — browser-only checks

`curl` reads server-rendered HTML. These need a real browser at
`http://localhost:5173`, logged in as `staf.ilj@example.test`, on a draft
period.

| # | Check | Expected |
|---|---|---|
| I.1 | Type in an amount field | Subtotals, section totals and the footer move on every keystroke, before saving |
| I.2 | Focus a field | Shows the raw number, text selected — not `1.500.000` |
| I.3 | Blur it | Reformats to `1.500.000` |
| I.4 | Press <kbd>Enter</kbd> in an amount field | Focus moves **down** to the next amount field, skipping subtotal rows. The form must **not** submit |
| I.5 | <kbd>Shift</kbd>+<kbd>Enter</kbd> | Moves up the column |
| I.6 | Press <kbd>Tab</kbd> | Moves **right** into Catatan, then on to the next row — Excel's behaviour |
| I.7 | Tab through the whole table | Focus never lands on a locked subtotal row |
| I.8 | Type a negative net result | Footer shows `(Rp …)` in red |
| I.9 | Submit with every line at 0 | A confirmation dialog appears; cancelling does not submit; confirming does |
| I.10 | Press **Kunci** on `/approval` | Confirmation naming that only direksi can reopen it |
| I.11 | Press **Buka kunci** as direksi | Confirmation naming the audit log and consolidation |
| I.12 | Click a queue row's entity name | Panel expands; the URL gains `?buka=…`; reload keeps it open |
| I.13 | Disable JavaScript, repeat Journey 1 | Create, save, submit all work; amounts post as typed; period picker needs its **Tampilkan** button |

I.4 and I.6 are the two that decide whether finance staff keep using this
screen or go back to a spreadsheet. I.13 is the one most likely to rot.

---

## Known gaps

Observed while writing this file. None is a defect in the checks above; each is
a decision worth revisiting.

- **An auditor can open `/approval` but has no link to it.** The nav item is
  gated on `canApprove()` per the task spec, while viewing is gated on
  `canReadAllEntities()`. The page works; there is no way to reach it except by
  typing the URL.
- **`/entry` answers 200 with a refusal panel for non-staff, while
  `/entry/[period]` answers 403.** Both refuse. The list page explains itself,
  the form does not.
- **The queue's Diajukan Oleh / Tanggal columns keep showing the last
  submitter after a rejection**, on a row now marked Draft. `submitted_at` is
  the last submission and that is what the column is defined as, but the pairing
  reads as though the period were still submitted.
- **No variance flag.** The prototype flagged any MoM move over 20% in amber.
  Nobody has decided that threshold, so it is not implemented (invariant 8).
  If a reviewer asks for it, that is a decision to record, not a default to
  pick.
- **Concurrency, still.** Two reviewers on one period is untested.

---

## Quick run

Before committing anything that touches these two screens:

```sh
npm run db:reset
npm test                          # the database layer, in under 5 seconds
npm run check                     # 0 errors, 0 warnings
npm run dev
# then Journeys 1-3 in order, then Part D, then Part G
```

`npm test` covers the guards themselves, so what is left by hand is short.
Journeys 1–3 walk a period through every screen state and prove each refusal
reaches the user as a sentence. Part D is the one place a silent hundredfold
error can enter between the field and the column. Part G is three lines and
catches a broken route guard immediately.

Then run [`TESTING.md`'s regression checklist](TESTING.md#regression-checklist).
