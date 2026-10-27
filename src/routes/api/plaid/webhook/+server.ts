import { json, text } from '@sveltejs/kit';
import { plaidConfigured } from '$lib/server/plaid/client';
import { applyPlaidWebhook, plaidKey, verifyPlaidWebhook, type PlaidWebhook } from '$lib/server/plaid/webhook';
import { startSync } from '$lib/server/syncJob';
import type { RequestHandler } from './$types';

/**
 * Plaid's webhooks (`PLAID_WEBHOOK_URL` points here). Public and exempt from
 * the origin check in `hooks.server.ts`, because Plaid has neither a session
 * nor an Origin; the signed `Plaid-Verification` JWT is the authentication
 * instead, checked before anything is read from the body.
 *
 * Plaid retries a webhook that does not get a 200, so everything verified
 * answers 200 -- including types this app does not act on.
 */
export const POST: RequestHandler = async ({ request }) => {
  if (!plaidConfigured()) return text('Not found', { status: 404 });
  const body = await request.text();
  const verdict = await verifyPlaidWebhook(body, request.headers.get('plaid-verification'), plaidKey);
  if (!verdict.ok) {
    console.warn(`[plaid] rejected a webhook: ${verdict.reason}`);
    return text('Unauthorized', { status: 401 });
  }

  let webhook: PlaidWebhook;
  try {
    webhook = JSON.parse(body);
  } catch {
    return text('Bad request', { status: 400 });
  }

  const { syncUserId, action } = await applyPlaidWebhook(webhook);
  // Never the item id or the user in the log line: the type is enough to
  // follow what Plaid is sending.
  console.log(`[plaid] webhook ${webhook.webhook_type}/${webhook.webhook_code} -> ${action}`);
  if (syncUserId) await startSync(syncUserId, 'webhook');
  return json({ ok: true });
};
