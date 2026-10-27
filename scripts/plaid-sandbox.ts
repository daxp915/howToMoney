// Connects a Plaid SANDBOX bank to a user without the browser flow, then syncs.
// Sandbox banks hold invented data; this refuses to run against production.
//
//   npm run plaid:sandbox -- someone@example.com            # First Platypus Bank
//   npm run plaid:sandbox -- someone@example.com ins_109511 # another test bank
//
// Categorization is skipped (no Anthropic spend on invented merchants) unless
// --categorize is passed.
import 'dotenv/config';
import { runAsUser } from '../src/lib/server/db';
import { plaidConfigured, plaidEnv, sandboxPublicToken } from '../src/lib/server/plaid/client';
import { connectPlaidItem } from '../src/lib/server/plaid/items';
import { runSync } from '../src/lib/server/sync/sync';
import { resolveUserArg } from './lib/whose';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const categorize = process.argv.includes('--categorize');
const [email, institutionId = 'ins_109508'] = args;

// Names for the sandbox institutions people actually pick.
const NAMES: Record<string, string> = {
  ins_109508: 'First Platypus Bank',
  ins_109509: 'First Gingham Credit Union',
  ins_109510: 'Tattersall Federal Credit Union',
  ins_109511: 'Tartan Bank',
  ins_109512: 'Houndstooth Bank'
};

async function main() {
  if (!plaidConfigured()) throw new Error('Set PLAID_CLIENT_ID and PLAID_SECRET in .env first.');
  if (plaidEnv() !== 'sandbox') throw new Error('PLAID_ENV is not sandbox; refusing to create test banks.');

  const user = await resolveUserArg(email);
  const name = NAMES[institutionId] ?? institutionId;

  const publicToken = await sandboxPublicToken(institutionId);
  const { itemId } = await runAsUser(user.id, () =>
    connectPlaidItem(publicToken, { id: institutionId, name })
  );
  console.log(`connected ${name} (item ${itemId.slice(0, 8)}…) for ${user.email}`);

  // A brand-new sandbox item can take a few seconds before its history is ready.
  for (let attempt = 1; attempt <= 5; attempt++) {
    const s = await runSync({ userId: user.id, days: 30, skipCategorize: !categorize });
    console.log(
      `sync ${attempt}: ${s.accountsSynced} accounts, ${s.inserted} new, ${s.updated} updated, ` +
        `${s.reconciledPending} pending promoted, ${s.transfersMatched} transfers` +
        (s.errors.length ? `, errors: ${s.errors.join(' | ')}` : '')
    );
    if (s.inserted > 0 || attempt === 5) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
