// Exchange the one-time SimpleFIN setup token for a long-lived access URL.
//
//   npm run simplefin:claim
//
// Reads SIMPLEFIN_SETUP_TOKEN from .env and stores the resulting access URL
// **encrypted in the database** (see src/lib/server/crypto.ts), then clears the
// spent token from .env. Neither secret is ever printed -- the only output is a
// count of the accounts now visible.
//
// A setup token can be claimed exactly ONCE. If this fails after the claim has
// gone through, generate a fresh token in the SimpleFIN UI.
import 'dotenv/config';
import * as env from './lib/envfile';
import { claimSetupToken, fetchAccounts } from '../src/lib/server/simplefin/client';
import { hasStoredCredentials, saveSimpleFinAccessUrl } from '../src/lib/server/simplefin/credentials';

async function main() {
  if (await hasStoredCredentials()) {
    console.log(
      'SimpleFIN credentials are already stored. Delete the row in provider_credentials ' +
        'to re-claim.'
    );
    return;
  }

  // Accept a token as an argument too, but the .env path is preferred: an
  // argument ends up in shell history.
  const token = process.argv[2] ?? env.get('SIMPLEFIN_SETUP_TOKEN');
  if (!token) {
    console.error('No token. Paste it into .env as SIMPLEFIN_SETUP_TOKEN, then re-run.');
    process.exit(1);
  }

  console.log('claiming setup token…');
  const accessUrl = await claimSetupToken(token);

  await saveSimpleFinAccessUrl(accessUrl, 'claimed via simplefin:claim');
  env.set('SIMPLEFIN_SETUP_TOKEN', '');
  console.log('claimed. Access URL encrypted into provider_credentials (not shown).');

  // Prove the credentials work before anything else depends on them. Balances
  // only, so this is a cheap call that pulls no transaction history. Amounts
  // are deliberately not printed -- the account list is enough to confirm the
  // connection, and this output often ends up in a terminal log.
  const probe = await fetchAccounts(accessUrl, { balancesOnly: true });
  console.log(`\n${probe.accounts.length} account(s) visible:`);
  for (const a of probe.accounts) {
    console.log(`  ${a.org?.name ?? 'unknown'} · ${a.name}`);
  }
  if (probe.errors?.length) console.warn('\nprovider errors:', probe.errors);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('claim failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
