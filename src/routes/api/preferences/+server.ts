import { error, json } from '@sveltejs/kit';
import { HOME_CARD_IDS, storeHomeCards } from '$lib/preferences';
import { savePreferences } from '$lib/server/preferences';
import type { RequestHandler } from './$types';

/**
 * Saves which cards Home shows, from Home's "Customize" list.
 *
 * Ids are filtered against the catalogue rather than trusted: this is a JSON
 * endpoint, so "what the page sent" and "what a person can send" are the same
 * thing, and an unknown id would sit in the preference forever doing nothing.
 * An empty list is allowed -- the hero is not a card and always stays.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');

  const body = (await request.json()) as { on?: unknown };
  if (!Array.isArray(body.on)) throw error(400, 'No cards given.');
  const on = body.on.filter((id): id is string => typeof id === 'string' && HOME_CARD_IDS.includes(id));

  await savePreferences(storeHomeCards(on));
  return json({ ok: true });
};
