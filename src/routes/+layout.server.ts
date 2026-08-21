import type { LayoutServerLoad } from './$types';

/**
 * Only what the shell needs to render. The session object itself is not
 * returned — it carries the access token, and nothing in the UI needs it.
 */
export const load: LayoutServerLoad = async ({ locals }) => ({
  isAuthenticated: locals.session !== null,
  role: locals.role,
  fullName: locals.fullName,
  email: locals.user?.email ?? null
});
