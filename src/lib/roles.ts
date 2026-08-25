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

/** SQL: can_read_all_entities() */
export function canReadAllEntities(role: UserRole | null): boolean {
  return role === 'direksi' || role === 'manajer_keuangan' || role === 'auditor';
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
