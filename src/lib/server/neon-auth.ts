/**
 * Server-side client for Neon Auth (managed Better Auth).
 *
 * Neon's SDK is built for the browser, and this portal never talks to auth
 * from the browser: login, session checks and account administration all
 * happen in `+page.server.ts` and `hooks.server.ts`. So this module speaks
 * Better Auth's HTTP API directly.
 *
 * The session lives in one httpOnly cookie owned by this app, holding the
 * value of Neon Auth's own session cookie. Every request exchanges it for a
 * fresh JWT through `get-session`; that JWT is what the Data API checks, and
 * its `sub` is what `auth.uid()` returns inside every RLS policy.
 *
 * Nothing here ever logs a password, a token or a cookie value.
 */

import { NEON_AUTH_BASE_URL } from '$env/static/private';

/** Our cookie. Neon's own name is only ever used towards Neon. */
export const SESSION_COOKIE = 'imr_session';
const NEON_SESSION_COOKIE = '__Secure-neon-auth.session_token';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  user: AuthUser;
  /** Short-lived JWT for the Data API. */
  jwt: string;
}

export class NeonAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string
  ) {
    super(message);
  }
}

/**
 * Better Auth rejects requests whose Origin it does not trust. The portal's
 * own origin is registered as a trusted domain, so every server call presents
 * it — the browser's Origin never reaches Neon.
 */
async function call(
  path: string,
  { origin, session, body }: { origin: string; session?: string; body?: unknown }
): Promise<Response> {
  const headers: Record<string, string> = { Origin: origin, Accept: 'application/json' };
  if (session) headers.Cookie = `${NEON_SESSION_COOKIE}=${session}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  return fetch(`${NEON_AUTH_BASE_URL}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });
}

async function fail(path: string, response: Response): Promise<never> {
  let code: string | null = null;
  let message = `${path} gagal dengan status ${response.status}`;
  try {
    const body = (await response.json()) as { code?: string; message?: string };
    code = body.code ?? null;
    if (body.message) message = body.message;
  } catch {
    // Not JSON; keep the status-only message.
  }
  throw new NeonAuthError(response.status, code, message);
}

/** Pulls Neon's session token out of a `set-cookie` header. */
function sessionFrom(response: Response): string | null {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const separator = pair.indexOf('=');
    if (pair.slice(0, separator).trim() === NEON_SESSION_COOKIE) {
      return pair.slice(separator + 1).trim();
    }
  }
  return null;
}

/** Returns the session token to store, or null for wrong credentials. */
export async function signIn(origin: string, email: string, password: string): Promise<string | null> {
  const response = await call('sign-in/email', { origin, body: { email, password } });
  if (response.status === 401 || response.status === 400 || response.status === 403) return null;
  if (!response.ok) await fail('sign-in', response);
  return sessionFrom(response);
}

export async function signOut(origin: string, session: string): Promise<void> {
  await call('sign-out', { origin, session, body: {} }).catch(() => undefined);
}

/**
 * Verifies the session with the auth server — the cookie alone proves
 * nothing — and returns the user plus a JWT for the Data API.
 */
export async function getSession(origin: string, session: string): Promise<AuthSession | null> {
  const response = await call('get-session', { origin, session });
  if (!response.ok) return null;

  const body = (await response.json()) as { user?: { id?: string; email?: string } } | null;
  const jwt = response.headers.get('set-auth-jwt');
  if (!body?.user?.id || !jwt) return null;

  return { user: { id: body.user.id, email: body.user.email ?? '' }, jwt };
}

/**
 * Account administration. Neon Auth authorizes these by the caller's own
 * auth role, which is `admin` exactly for active directors — see
 * `authRoleFor`. There is no service key anywhere in this application.
 */
export const admin = {
  async listUsers(origin: string, session: string): Promise<AuthUser[]> {
    const response = await call('admin/list-users?limit=500', { origin, session });
    if (!response.ok) await fail('list-users', response);
    const body = (await response.json()) as { users?: { id: string; email: string }[] };
    return (body.users ?? []).map((user) => ({ id: user.id, email: user.email }));
  },

  async createUser(
    origin: string,
    session: string,
    input: { email: string; password: string; name: string; role: AuthRole }
  ): Promise<string> {
    const response = await call('admin/create-user', { origin, session, body: input });
    if (!response.ok) await fail('create-user', response);
    const body = (await response.json()) as { user?: { id?: string } };
    if (!body.user?.id) throw new NeonAuthError(502, null, 'create-user tidak mengembalikan id');
    return body.user.id;
  },

  async removeUser(origin: string, session: string, userId: string): Promise<void> {
    const response = await call('admin/remove-user', { origin, session, body: { userId } });
    if (!response.ok) await fail('remove-user', response);
  },

  async setPassword(origin: string, session: string, userId: string, newPassword: string): Promise<void> {
    const response = await call('admin/set-user-password', {
      origin,
      session,
      body: { userId, newPassword }
    });
    if (!response.ok) await fail('set-user-password', response);
  },

  async setRole(origin: string, session: string, userId: string, role: AuthRole): Promise<void> {
    const response = await call('admin/set-role', { origin, session, body: { userId, role } });
    if (!response.ok) await fail('set-role', response);
  },

  /** Banning also revokes every session the user holds. */
  async ban(origin: string, session: string, userId: string): Promise<void> {
    const response = await call('admin/ban-user', { origin, session, body: { userId } });
    if (!response.ok) await fail('ban-user', response);
  },

  async unban(origin: string, session: string, userId: string): Promise<void> {
    const response = await call('admin/unban-user', { origin, session, body: { userId } });
    if (!response.ok) await fail('unban-user', response);
  }
};

export type AuthRole = 'admin' | 'user';

/**
 * Only directors may administer accounts, so only directors hold the auth
 * `admin` role. Kept in step with `profiles.role` by /admin/users; a
 * deactivated account is banned instead, which also ends its sessions.
 */
export function authRoleFor(role: string): AuthRole {
  return role === 'direksi' ? 'admin' : 'user';
}
