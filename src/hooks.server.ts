import { createServerClient } from '@supabase/ssr';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { UserRole } from '$lib/domain';

/**
 * One Supabase client per request, carrying the caller's cookies. Every query
 * therefore runs as that user and RLS decides what comes back — which is
 * where authorization lives (CLAUDE.md invariant 1).
 */
const supabase: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => event.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          // SvelteKit requires an explicit path; Supabase leaves it implicit.
          event.cookies.set(name, value, { ...options, path: '/' });
        }
      }
    }
  });

  /**
   * `getSession()` alone reads an unverified JWT out of a cookie the user
   * controls. Nothing may depend on it until `getUser()` has checked the
   * signature against the auth server.
   */
  event.locals.safeGetSession = async () => {
    const {
      data: { session }
    } = await event.locals.supabase.auth.getSession();
    if (!session) return { session: null, user: null };

    const {
      data: { user },
      error
    } = await event.locals.supabase.auth.getUser();
    if (error) return { session: null, user: null };

    return { session, user };
  };

  return resolve(event, {
    filterSerializedResponseHeaders: (name) => name === 'content-range' || name === 'x-supabase-api-version'
  });
};

/** Routes reachable without a session. Everything else redirects to login. */
const PUBLIC_ROUTES = ['/login', '/auth'];

const authGuard: Handle = async ({ event, resolve }) => {
  const { session, user } = await event.locals.safeGetSession();
  event.locals.session = session;
  event.locals.user = user;
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

export const handle = sequence(supabase, authGuard);
