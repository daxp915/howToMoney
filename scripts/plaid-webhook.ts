// Points every stored Plaid item at PLAID_WEBHOOK_URL.
//
//   npm run plaid:webhook
//
// New connections get the URL when Link opens (`createLinkToken`); items linked
// before it was set never would, and keep waiting for the worker's schedule.
// Cross-tenant on purpose (every household's items), so it reads through
// systemDb and touches nothing but Plaid's record of where to call.
import 'dotenv/config';
import { systemDb } from '../src/lib/server/db';
import { plaidItems } from '../src/lib/server/db/schema';
import { decryptSecret } from '../src/lib/server/crypto';
import { itemWebhookUpdate, plaidConfigured, plaidWebhookUrl } from '../src/lib/server/plaid/client';

async function main() {
  if (!plaidConfigured()) throw new Error('Set PLAID_CLIENT_ID and PLAID_SECRET first.');
  const url = plaidWebhookUrl();
  if (!url) throw new Error('Set PLAID_WEBHOOK_URL to the public address of /api/plaid/webhook first.');
  if (!url.startsWith('https://')) throw new Error('PLAID_WEBHOOK_URL must be https.');

  const items = await systemDb.select({ id: plaidItems.id, accessToken: plaidItems.accessToken }).from(plaidItems);
  let ok = 0;
  for (const item of items) {
    try {
      await itemWebhookUpdate(decryptSecret(item.accessToken), url);
      ok++;
    } catch (e) {
      console.error(`item ${item.id.slice(0, 8)}…: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`${ok} of ${items.length} item(s) now send webhooks to ${url}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
