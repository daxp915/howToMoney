import { error, json } from '@sveltejs/kit';
import { connectPlaidItem } from '$lib/server/plaid/items';
import { plaidConfigured, PlaidError } from '$lib/server/plaid/client';
import type { RequestHandler } from './$types';

/**
 * Link finished: trade its public token for the bank's access token (stored
 * encrypted, never sent back). The page then syncs, so a new connection shows
 * its accounts straight away, as a SimpleFIN token does.
 *
 * POST { publicToken, institution: { institution_id, name } }
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  if (!plaidConfigured()) throw error(404, 'Plaid is not set up on this server');

  const body = (await request.json().catch(() => ({}))) as {
    publicToken?: unknown;
    institution?: { institution_id?: unknown; name?: unknown } | null;
  };
  if (typeof body.publicToken !== 'string' || !body.publicToken.startsWith('public-')) {
    throw error(400, 'Missing the token from Plaid. Try connecting again.');
  }
  const inst = body.institution ?? {};

  try {
    await connectPlaidItem(body.publicToken, {
      id: typeof inst.institution_id === 'string' ? inst.institution_id : null,
      name: typeof inst.name === 'string' ? inst.name.slice(0, 120) : null
    });
  } catch (e) {
    console.error('[plaid] exchange failed', e);
    throw error(502, e instanceof PlaidError ? e.message : 'Plaid could not finish connecting. Try again.');
  }

  // The page starts the sync (sync.start()) once this answers. Starting it
  // here would race the request's own transaction: the job opens a fresh one
  // on the next tick, likely before this request's insert has committed, and
  // would sync without the bank it was started for.
  return json({ connected: true });
};
