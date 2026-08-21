import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

/**
 * Credentials are never in source and never displayed. The prototype printed
 * working logins on its login screen (see CLAUDE.md anti-patterns).
 */
export const actions: Actions = {
  default: async ({ request, url, locals }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (!email || !password) {
      return fail(400, { email, message: 'Email dan kata sandi wajib diisi.' });
    }

    const { error } = await locals.supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Deliberately not distinguishing "unknown email" from "wrong password":
      // that difference tells an attacker which addresses exist.
      return fail(400, { email, message: 'Email atau kata sandi tidak sesuai.' });
    }

    // Only same-origin paths. An absolute URL here would be an open redirect.
    const requested = url.searchParams.get('redirectTo');
    const target = requested && requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

    redirect(303, target);
  }
};
