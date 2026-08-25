import type { LayoutServerLoad } from './$types';

/**
 * Only what the shell needs to render. The session object itself is not
 * returned — it carries the access token, and nothing in the UI needs it.
 */
export const load: LayoutServerLoad = async ({ locals, cookies }) => ({
  isAuthenticated: locals.session !== null,
  role: locals.role,
  fullName: locals.fullName,
  email: locals.user?.email ?? null,
  /**
   * A display preference, not a permission — it decides nothing but the width
   * of the rail. Read here rather than from localStorage so the server renders
   * the sidebar at the width the user last chose; read after hydration
   * instead, it would visibly jump on every full page load.
   */
  sidebarCollapsed: cookies.get('sidebar') === 'rail'
});
