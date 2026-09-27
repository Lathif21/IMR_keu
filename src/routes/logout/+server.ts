import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, signOut } from '$lib/server/neon-auth';
import type { RequestHandler } from './$types';

/** POST only: a GET would let any page log the user out with an <img> tag. */
export const POST: RequestHandler = async ({ cookies, locals, url }) => {
  if (locals.session) await signOut(url.origin, locals.session);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  redirect(303, '/login');
};
