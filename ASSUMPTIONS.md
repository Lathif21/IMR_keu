# Assumptions & Open Decisions

Decisions that belong to an accountant but haven't been made yet. The client
is currently unreachable, so development proceeds on the assumptions below.

**Rule: the system never silently picks a default.** Where a policy is
undecided, the schema stores `NULL` in `accounting_policies` and the UI shows
that the figure is provisional. Do not "fix" this by choosing a value.

When an item is resolved, move it to Resolved with the date and who decided.

---

## Open

### A-1 · Revenue presentation: principal or agent
**Assumed:** `unknown`. Entities report whatever they already report; the
system does not convert.
**If wrong:** Group revenue is off by up to 6× for ILJ (Rp235jt vs Rp39jt/month).
Net profit unaffected.
**Breaks:** Nothing structural. `entities.revenue_presentation` gets set;
cross-entity revenue comparisons become meaningful.
**Policy key:** `revenue_presentation_trucking`

### A-2 · Uang saku: expense or advance
**Assumed:** The `COGS_SAKU` line exists and entities put whatever they
currently do into it (at ILJ, historically: nothing).
**If wrong:** Monthly profit is off by ~Rp104jt at ILJ. If it's an advance,
there is a receivable of that size that this system cannot represent at all.
**Breaks:** If it's an advance, we need an advance-settlement module. That is
a new feature, not a config change.
**Policy key:** `uang_saku_treatment`

### A-3 · 65/35 profit split: expense or distribution
**Assumed:** Not modelled. No line exists for it; entities report profit
before the split.
**If wrong:** If it's an operating expense, net profit is overstated.
**Evidence it's a distribution:** In Jul 2025 the split was applied to a
*negative* result (−Rp1.42jt / −Rp0.76jt). Expenses don't go negative;
owner shares do.
**Policy key:** `profit_sharing_65_35`

### A-4 · Accounting basis: cash or accrual
**Assumed:** `unknown` per entity. Whatever they submit is stored as-is.
**If wrong:** Nothing breaks, but comparisons stay unreliable. ILJ's Jul 2025
result (−Rp2.1jt after Rp88jt in June) is entirely a cash-basis artifact —
Jan–Mar PPh 23 of Rp21.3jt landed in July.
**Policy key:** `accounting_basis`

### A-5 · Intercompany transactions exist
**Assumed:** They might. The registry and elimination view are built, but
seeded empty.
**If wrong (none exist):** Harmless — the feature sits unused.
**If wrong (many exist):** Fine too; the registry scales. Only matters if they
turn out to need per-line rather than per-transaction elimination.

### A-6 · Entity list and legal form
**Assumed:** Four entities, all PT, all 100% owned, all Jan–Dec fiscal year.
Only ILJ confirmed.
**If wrong:** `ownership_pct` and `fiscal_year_start_month` already exist in
the schema, so partial ownership or an offset fiscal year is a data change,
not a migration. A non-PT entity may need to be excluded from consolidation
entirely — that *is* a design question.

### A-7 · Chart of accounts not needed yet
**Assumed:** The portal reports at line level; no COA.
**If wrong:** `report_template_lines.account_code` is already nullable and
unused. Populating it plus adding a `chart_of_accounts` table with an FK is
the whole migration. Input, approval, and reporting layers do not change.
**This is the single most important design property of the schema. Don't break it.**

### A-8 · Balance sheet out of scope
**Assumed:** P&L only. No assets, liabilities, or equity.
**Why:** No opening balances exist for any entity. Not a scoping choice —
there is nothing to build from.
**If wrong:** Needs A-4 resolved, opening balances prepared per entity, and a
double-entry model. That is Phase 2, not an extension of this.

### A-9 · Report template seeded from ILJ's existing statement
**Assumed:** The line structure ILJ has used since Nov 2024 is a reasonable
default for trucking entities.
**If wrong:** Templates are versioned data. Add v2, leave v1 lines intact so
historical periods still read correctly.

---

## Resolved

<!-- Move items here as:
### A-n · Title
**Decided:** value · **By:** name · **On:** YYYY-MM-DD
**Rationale:** why
**Changed:** what was updated in code/data
-->

*(none yet)*
