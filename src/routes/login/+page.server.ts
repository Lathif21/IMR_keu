import { fail, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, signIn } from '$lib/server/neon-auth';
import type { Actions } from './$types';

/**
 * Resolve `?redirectTo=` to a path on this origin, or to `/`.
 *
 * A `startsWith('/') && !startsWith('//')` test is not enough. Browsers strip
 * tab, LF and CR from a URL before resolving it, so `/\t/evil.example.com`
 * passes that test and then becomes `//evil.example.com` — a protocol-relative
 * URL pointing off-site. Backslashes get the same treatment for http(s).
 *
 * So: drop the characters browsers drop, then resolve against our own origin
 * and require that the result actually stayed there. The origin check is the
 * real defence; the prefix test just rejects the obvious cases early.
 */
function safeRedirect(requested: string | null, origin: string): string {
  if (!requested) return '/';

  const cleaned = requested.replace(/[\t\n\r]/g, '');
  if (!cleaned.startsWith('/') || cleaned.startsWith('//')) return '/';

  try {
    const resolved = new URL(cleaned, origin);
    return resolved.origin === origin ? resolved.pathname + resolved.search : '/';
  } catch {
    return '/';
  }
}

/**
 * Credentials are never in source and never displayed. The prototype printed
 * working logins on its login screen (see CLAUDE.md anti-patterns).
 */
export const actions: Actions = {
  default: async ({ request, url, cookies }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (!email || !password) {
      return fail(400, { email, message: 'Email dan kata sandi wajib diisi.' });
    }

    let session: string | null;
    try {
      session = await signIn(url.origin, email, password);
    } catch (cause) {
      console.error('[login] Neon Auth:', (cause as Error).message);
      return fail(502, { email, message: 'Layanan login sedang tidak dapat dihubungi. Coba lagi.' });
    }

    if (!session) {
      // Deliberately not distinguishing "unknown email" from "wrong password"
      // (or a banned account): that difference tells an attacker which
      // addresses exist.
      return fail(400, { email, message: 'Email atau kata sandi tidak sesuai.' });
    }

    cookies.set(SESSION_COOKIE, session, {
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'lax',
      // Neon Auth sessions last seven days; the cookie does not outlive them.
      maxAge: 60 * 60 * 24 * 7
    });

    redirect(303, safeRedirect(url.searchParams.get('redirectTo'), url.origin));
  }
};
