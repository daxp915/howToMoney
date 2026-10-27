import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { plaidItems } from '$lib/server/db/schema';
import { decryptSecret } from '$lib/server/crypto';
import { createLinkToken, plaidConfigured, PlaidError } from '$lib/server/plaid/client';
import type { RequestHandler } from './$types';

/**
 * A one-time token that opens Plaid Link in the browser.
 *
 * POST {}                -> connect a new bank
 * POST { itemId: uuid }  -> update mode: sign in again to a bank already
 *                           connected (ITEM_LOGIN_REQUIRED). Row-level security
 *                           means an id from another household finds nothing.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  if (!plaidConfigured()) throw error(404, 'Plaid is not set up on this server');

  const body = (await request.json().catch(() => ({}))) as { itemId?: unknown };
  let accessToken: string | undefined;
  if (typeof body.itemId === 'string') {
    const [item] = await db.select().from(plaidItems).where(eq(plaidItems.id, body.itemId));
    if (!item) throw error(404, 'That bank connection was not found');
    accessToken = decryptSecret(item.accessToken);
  }

  try {
    const linkToken = await createLinkToken(locals.user.id, { accessToken });
    return json({ linkToken });
  } catch (e) {
    const message = e instanceof PlaidError ? e.message : 'Plaid could not be reached. Try again in a minute.';
    console.error('[plaid] link token failed', e);
    throw error(502, message);
  }
};
