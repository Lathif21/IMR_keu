# Domain Language

The business runs in Indonesian; the code is in English. This file is the
bridge. Use these exact terms in identifiers, comments, and conversation —
inconsistent naming here has already produced wrong numbers once.

## Core nouns

| Term | Code | Meaning |
|---|---|---|
| Entitas | `entity` | One PT with its own NPWP. Four of them. Never "company" or "division" — they are separate legal entities and consolidate with elimination. |
| Periode | `period` | One reporting month for one entity. Always stored as the 1st of the month. `(entity, period)` is unique. |
| Baris laporan | `report_line` | One input figure for one period. Subtotals are never lines. |
| Template | `report_template` | The set of lines an entity fills in. Data, not code. Versioned. |
| Tagihan | `REV_TAGIHAN` | Amount invoiced to the customer. The primary revenue line for trucking. |
| Rekanan | `COGS_REKANAN` | Payment to the partner who owns the vessel/truck. Largest cost line by far (~83% of tagihan at ILJ). |
| Telly | — | The field supervisor responsible for a shipment. Named person, not a role in the auth system. |
| Uang saku | `COGS_SAKU` | Cash advanced to a telly for a trip. **Treatment undecided** — see `ASSUMPTIONS.md`. |
| Terpal | `COGS_TERPAL` | Tarpaulin cost. Historically recorded at 50% — the split arrangement is undocumented. |
| Ritase | — | Number of trips. Operational metric, not financial. Not stored in this system. |
| Muatan | — | Tonnage carried. Operational metric. Not stored. |

## Workflow verbs

| Term | Status | Who |
|---|---|---|
| Draft | `draft` | Entity staff is still filling it in. Only state where lines are editable. |
| Diajukan | `submitted` | Entity staff has submitted; awaiting review. |
| Disetujui | `approved` | Finance manager approved. Enters consolidation. |
| Dikunci | `locked` | Final. Only a director can unlock, and it's audited. |
| Ditolak | → `draft` | Not a status. Rejection returns to `draft` with a mandatory note. |

## Concepts that are easy to get wrong

**Konsolidasi ≠ penjumlahan.** Consolidation means summing the entities *and
then eliminating* transactions between them. If ILJ invoices ZAZ for hauling,
that amount is revenue in one book and cost in the other; adding both inflates
group revenue. "Sum of four entities" is `revenue_sum`; the real number is
`revenue_consolidated`.

**Basis pelaporan.** Each entity declares whether it reports on a cash or
accrual basis, and whether revenue is presented gross or net. Both default to
`unknown`. Two entities on different bases are **not comparable** — any UI that
puts them side by side must say so. This is the difference between "ILJ is our
biggest line" and "ILJ counts revenue differently".

**Gross vs net.** If the entity is a principal, revenue is the full invoice.
If it's an agent, revenue is only the margin. At ILJ that's the difference
between Rp235jt and Rp39jt for the same month. Net profit is identical either
way — only the top line and the shape of the statement change.

**Kelengkapan.** A consolidated figure computed while entities are still
missing is not a smaller version of the real number — it's a different number.
Always carry `is_complete` and `missing_entities` alongside any group total.

## Entities

| Code | Legal name | Line | Notes |
|---|---|---|---|
| ILJ | PT Indra Langgeng Jaya | trucking | Only entity with real historical data (Nov 2024 – Jul 2025) |
| — | *(to confirm)* | amdk | Bottled water manufacturing |
| — | *(to confirm)* | mining | |
| — | *(to confirm)* | salt | Legal form unconfirmed — may not be a PT |

Entity names in the original prototype were placeholders. Confirm before
seeding production.

## Naming rules

- Line codes: `SECTION_NAME` in caps — `REV_TAGIHAN`, `COGS_REKANAN`,
  `OPEX_GAJI`. Section prefix matches the `line_section` enum.
- Never translate a line label in code. `line_label` holds the Indonesian
  text users see; `line_code` is the stable English-ish identifier.
- Money variables carry the unit: `amount_idr`, not `amount`. There is no
  other currency, but the suffix stops anyone reintroducing "in millions".
