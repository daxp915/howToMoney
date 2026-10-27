import { error, json } from '@sveltejs/kit';
import { dismissTip } from '$lib/server/preferences';
import type { RequestHandler } from './$types';

/** "Got it" on a one-time tip. POST { id }; ids are short slugs. */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw error(400, 'Bad tip id');
  await dismissTip(id);
  return json({ ok: true });
};
