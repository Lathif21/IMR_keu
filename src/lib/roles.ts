/**
 * Mirror of the role predicates in supabase/migrations. These exist to shape
 * the UI — which nav items appear, which panels render, which empty state a
 * user sees.
 *
 * They are NOT the security boundary. Authorization is RLS (CLAUDE.md
 * invariant 1). A user who defeats every check in this file still cannot read
 * or write a single row Postgres refuses them. Never use these to decide
 * whether a write is allowed; let the database refuse and report the error.
 *
 * If a predicate here disagrees with the SQL, the SQL is right.
 */

import type { UserRole } from './domain';

/**
 * SQL: can_read_all_entities()
 *
 * Direksi only. Every other role — manajer_keuangan and auditor included —
 * sees the entities it was assigned in `user_entity_access`, exactly as entity
 * staff do. This is about the SCOPE OF ROWS, nothing else: it is not the test
 * for reading group-level tables (`canReadGroupData`), for reviewing a queue
 * (`canReviewSubmissions`), or for administering master data (`isDirector`).
 */
export function canReadAllEntities(role: UserRole | null): boolean {
  return role === 'direksi';
}

/**
 * SQL: can_read_group_data()
 *
 * Tables with no `entity_id` at all — profiles, intercompany_transactions,
 * audit_log. Entity scope cannot narrow a table that has no entity column, so
 * these need their own predicate; folding them back into
 * `canReadAllEntities()` would take the approval queue's submitter names away
 * from a manajer and the audit trail away from the auditor whose job it is.
 */
export function canReadGroupData(role: UserRole | null): boolean {
  return role === 'direksi' || role === 'manajer_keuangan' || role === 'auditor';
}

/**
 * Who the Persetujuan screen is for. Reviewing is reading, so an auditor
 * belongs here and sees the queue with no action buttons — `canApprove()`
 * gates those, and RLS enforces the same via `is_readonly_role()`.
 *
 * Same three roles as `canReadGroupData()` today, and deliberately a separate
 * function: one is about which tables you may read, the other about which
 * screen you have business on. They will not always move together.
 */
export function canReviewSubmissions(role: UserRole | null): boolean {
  return role === 'direksi' || role === 'manajer_keuangan' || role === 'auditor';
}

/**
 * Whose visible entities come from `user_entity_access` — everyone except
 * direksi. This is what the Pengguna screen asks before offering the entity
 * checkboxes: for a scoped role, an empty assignment list now means an empty
 * application, so the assignment is not optional detail.
 */
export function isEntityScopedRole(role: UserRole | null): boolean {
  return role !== null && role !== 'direksi';
}

/** SQL: can_approve() */
export function canApprove(role: UserRole | null): boolean {
  return role === 'direksi' || role === 'manajer_keuangan';
}

/** SQL: is_readonly_role() */
export function isReadonlyRole(role: UserRole | null): boolean {
  return role === 'auditor';
}

/** Only entity staff fill in a report; everyone else reads it. */
export function canEnterReports(role: UserRole | null): boolean {
  return role === 'staf_entitas';
}

/** Only a director can unlock a locked period, and it is audited. */
export function canUnlockPeriod(role: UserRole | null): boolean {
  return role === 'direksi';
}

/**
 * SQL: `current_user_role() = 'direksi'`, which is the USING clause on
 * `entities_write`, `profiles_manage`, `uea_manage`, `templates_manage` and
 * `template_lines_manage` — every policy guarding master data.
 *
 * Distinct from `canUnlockPeriod()` even though both are true for exactly one
 * role today: one is about administering the system, the other about a single
 * workflow transition. Collapsing them would tie two unrelated decisions to
 * one predicate.
 */
export function isDirector(role: UserRole | null): boolean {
  return role === 'direksi';
}
