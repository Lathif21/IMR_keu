import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** POST only: a GET would let any page log the user out with an <img> tag. */
export const POST: RequestHandler = async ({ locals }) => {
  await locals.supabase.auth.signOut();
  redirect(303, '/login');
};
