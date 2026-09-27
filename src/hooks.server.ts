import { createClient } from '@supabase/supabase-js';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { NEON_DATA_API_URL } from '$env/static/private';
import type { UserRole } from '$lib/domain';
import { getSession, SESSION_COOKIE } from '$lib/server/neon-auth';
import { parseTheme, THEME_COOKIE } from '$lib/theme';

/**
 * One Data API client per request, carrying the caller's JWT. Every query
 * therefore runs as that user and RLS decides what comes back — which is
 * where authorization lives (CLAUDE.md invariant 1).
 *
 * The Data API speaks PostgREST, so `supabase-js` queries work unchanged;
 * only its auth half is unused. The session cookie is checked against Neon
 * Auth on every request — its content proves nothing by itself — and that
 * check is what yields the JWT.
 */
const supabase: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get(SESSION_COOKIE) ?? null;
  const auth = token ? await getSession(event.url.origin, token) : null;

  if (token && !auth) {
    // Expired, revoked or banned: drop it so the next request is clean.
    event.cookies.delete(SESSION_COOKIE, { path: '/' });
  }

  event.locals.session = auth ? token : null;
  event.locals.user = auth?.user ?? null;
  event.locals.supabase = createClient(NEON_DATA_API_URL, 'neon-data-api', {
    accessToken: async () => auth?.jwt ?? null
  });

  return resolve(event, {
    filterSerializedResponseHeaders: (name) => name === 'content-range'
  });
};

/** Routes reachable without a session. Everything else redirects to login. */
const PUBLIC_ROUTES = ['/login', '/auth'];

const authGuard: Handle = async ({ event, resolve }) => {
  const { session, user } = event.locals;
  event.locals.role = null;
  event.locals.fullName = null;

  if (user) {
    /**
     * Role is read once per request for UI shaping — which nav items show,
     * which buttons render. It is NOT a permission check: a user who forges
     * this still cannot read or write anything RLS forbids.
     */
    /**
     * `is_active` matters: SQL `current_user_role()` returns NULL for a
     * deactivated profile, so RLS already refuses them everything. Without
     * the same filter here the UI would still hand them a role and render
     * screens that then come back empty, which reads as a broken app rather
     * than a revoked account.
     */
    const { data: profile } = await event.locals.supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    event.locals.role = (profile?.role as UserRole | undefined) ?? null;
    event.locals.fullName = profile?.full_name ?? null;
  }

  const isPublic = PUBLIC_ROUTES.some((route) => event.url.pathname.startsWith(route));

  if (!session && !isPublic) {
    const target = event.url.pathname + event.url.search;
    redirect(303, `/login?redirectTo=${encodeURIComponent(target)}`);
  }

  if (session && event.url.pathname === '/login') {
    redirect(303, '/');
  }

  return resolve(event);
};

/**
 * Stamps the chosen palette onto `<html>` in the response itself. Doing it here
 * rather than from a component is the whole point: `app.css` keys every colour
 * off this attribute, so if it arrived only after hydration the page would
 * paint dark and then snap to light on every full load.
 */
const theme: Handle = async ({ event, resolve }) => {
  const chosen = parseTheme(event.cookies.get(THEME_COOKIE));
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%theme%', chosen)
  });
};

export const handle = sequence(theme, supabase, authGuard);
