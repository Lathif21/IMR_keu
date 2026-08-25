import { redirect } from '@sveltejs/kit';
import { isDirector } from '$lib/roles';
import type { LayoutServerLoad } from './$types';

/**
 * Every screen under `/admin` inherits this. UI shaping, not the boundary:
 * a manager who defeats it still cannot write a row, because
 * `entities_write`, `profiles_manage` and `templates_manage` all require
 * `current_user_role() = 'direksi'` in the database (invariant 1).
 *
 * A redirect rather than a 403 — these routes are not advertised to anyone
 * else, and a 403 would confirm they exist.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
  if (!isDirector(locals.role)) redirect(303, '/');
  return {};
};
