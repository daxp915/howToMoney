import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { plaidItems } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * Link's update mode finished: the person signed in to their bank again. The
 * access token is unchanged (update mode keeps it), so all that is left is to
 * clear the error; the page then syncs. If the bank still refuses, the sync
 * writes the code back and the banner returns.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  const { itemId } = (await request.json().catch(() => ({}))) as { itemId?: unknown };
  if (typeof itemId !== 'string') throw error(400, 'Which bank?');

  const updated = await db
    .update(plaidItems)
    .set({ errorCode: null })
    .where(eq(plaidItems.id, itemId))
    .returning({ id: plaidItems.id });
  if (!updated.length) throw error(404, 'That bank connection was not found');

  return json({ ok: true });
};
