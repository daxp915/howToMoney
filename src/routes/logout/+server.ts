import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, invalidateSession } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
  const id = cookies.get(SESSION_COOKIE);
  if (id) await invalidateSession(id);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  throw redirect(303, '/login');
};
