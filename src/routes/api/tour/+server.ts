import { error, json } from '@sveltejs/kit';
import { savePreferences } from '$lib/server/preferences';
import type { RequestHandler } from './$types';

/** Marks the welcome tour as seen. Replaying it is a Settings action. */
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');

  await savePreferences({ tourSeenAt: new Date() });
  return json({ ok: true });
};
