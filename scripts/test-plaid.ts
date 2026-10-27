// Plaid → ledger mapping. Pure: no database, no network.
//   npm run test:plaid
//
// The case that matters most is the sign: Plaid reports money OUT as positive,
// the app stores it negative. Get it backwards and every figure inverts.
import { accountType, dayAt, mapAccount, mapTransaction, money } from '../src/lib/server/plaid/map';
import type { PlaidAccount, PlaidTransaction } from '../src/lib/server/plaid/client';

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} :: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
}

const txn = (over: Partial<PlaidTransaction>): PlaidTransaction => ({
  transaction_id: 't1',
  account_id: 'a1',
  amount: 5.4,
  iso_currency_code: 'USD',
  date: '2026-10-11',
  authorized_date: '2026-10-10',
  name: 'Uber 063015 SF**POOL**',
  merchant_name: 'Uber',
  pending: false,
  pending_transaction_id: null,
  ...over
});

const acct = (over: Partial<PlaidAccount> & { balances?: Partial<PlaidAccount['balances']> }): PlaidAccount => ({
  account_id: 'a1',
  name: 'Plaid Checking',
  official_name: null,
  mask: '0000',
  type: 'depository',
  subtype: 'checking',
  ...over,
  balances: { current: 110, available: 100, iso_currency_code: 'USD', ...over.balances }
});

// ---- money ----
check('two decimals', money(5.4), '5.40');
check('float noise is removed', money(19.99), '19.99');
check('large', money(47888.65), '47888.65');
check('negative zero is zero', money(-0), '0.00');
check('half a cent rounds away from zero', money(-0.005), '-0.01');

// ---- the sign flip ----
check('a purchase (Plaid +5.40) is money out', mapTransaction(txn({ amount: 5.4 })).amount, '-5.40');
check('a paycheck (Plaid -1500) is money in', mapTransaction(txn({ amount: -1500 })).amount, '1500.00');
check('a refund on a card (Plaid -20) is money in', mapTransaction(txn({ amount: -20 })).amount, '20.00');

// ---- fields ----
const t = mapTransaction(txn({}));
check('payee is the cleaned merchant', t.payee, 'Uber');
check('description is the raw descriptor', t.description, 'Uber 063015 SF**POOL**');
check('original_description wins when present', mapTransaction(txn({ original_description: 'UBER *TRIP' })).description, 'UBER *TRIP');
check('no merchant: payee null', mapTransaction(txn({ merchant_name: null })).payee, null);
check('posted day lands on that day at noon UTC', t.postedAt.toISOString(), '2026-10-11T12:00:00.000Z');
check('transactedAt from authorized_date', t.transactedAt?.toISOString(), '2026-10-10T12:00:00.000Z');
check('noon UTC is the same calendar day in New York', dayAt('2026-10-31').toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), '2026-10-31');
check('noon UTC is the same calendar day in Honolulu', dayAt('2026-10-31').toLocaleDateString('en-CA', { timeZone: 'Pacific/Honolulu' }), '2026-10-31');

// ---- pending ----
check('a posted row names the pending row it replaces', mapTransaction(txn({ pending_transaction_id: 'p9' })).replacesPendingId, 'p9');
// null, not undefined: undefined would switch on SimpleFIN's amount-and-date guessing.
check('a posted row with no pending: null (no guessing)', mapTransaction(txn({})).replacesPendingId, null);
check('pending flag carried', mapTransaction(txn({ pending: true })).pending, true);

// ---- accounts ----
check('types map through', ['depository', 'credit', 'loan', 'investment', 'brokerage', 'other'].map((type) => accountType({ type: type as PlaidAccount['type'] })), ['depository', 'credit', 'loan', 'investment', 'investment', 'other']);

const checking = mapAccount(acct({}), 'First Platypus Bank');
check('checking balance stays positive', checking.balance, '110.00');
check('checking keeps available', checking.availableBalance, '100.00');
check('name carries the mask like SimpleFIN accounts', checking.name, 'Plaid Checking (0000)');
check('org name from the item', checking.orgName, 'First Platypus Bank');
check('provider is plaid', checking.provider, 'plaid');

const card = mapAccount(acct({ type: 'credit', subtype: 'credit card', balances: { current: 410.5, available: 1589.5 } }), null);
check('a card owing $410.50 is held negative', card.balance, '-410.50');
check("a card's available credit is not a balance", card.availableBalance, null);

const loan = mapAccount(acct({ type: 'loan', subtype: 'auto', balances: { current: 9590.52, available: null } }), null);
check('a loan is held negative', loan.balance, '-9590.52');

const unknown = mapAccount(acct({ balances: { current: null, available: null } }), null);
check('no balance stays null', unknown.balance, null);

// ---- webhooks ---------------------------------------------------------------
// Signed here with a key of our own, standing in for Plaid's: what is under
// test is that a forged, stale or altered webhook is refused before anything
// reads it.
const { verifyPlaidWebhook, webhookAction } = await import('../src/lib/server/plaid/webhook');
const crypto = await import('node:crypto');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pub = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string };
const jwk = { ...pub, kid: 'k1', alg: 'ES256', created_at: 0, expired_at: null };
const getKey = async (kid: string) => (kid === 'k1' ? jwk : null);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = 1_800_000_000_000;
function sign(body: string, over: { alg?: string; kid?: string; iat?: number; hash?: string } = {}) {
  const head = b64({ alg: over.alg ?? 'ES256', kid: over.kid ?? 'k1', typ: 'JWT' });
  const payload = b64({
    iat: over.iat ?? NOW / 1000 - 10,
    request_body_sha256: over.hash ?? crypto.createHash('sha256').update(body).digest('hex')
  });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${payload}.${sig.toString('base64url')}`;
}
const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'i1' });
const verdict = async (b: string, t: string | null) => (await verifyPlaidWebhook(b, t, getKey, NOW)).ok;
check('a signed webhook is accepted', await verdict(body, sign(body)), true);
check('no header is refused', await verdict(body, null), false);
check('a changed body is refused', await verdict(body.replace('i1', 'i2'), sign(body)), false);
check('a token older than five minutes is refused', await verdict(body, sign(body, { iat: NOW / 1000 - 301 })), false);
check('an unknown key is refused', await verdict(body, sign(body, { kid: 'k9' })), false);
check('alg none is refused', await verdict(body, sign(body, { alg: 'none' })), false);
const [h, p, sig] = sign(body).split('.');
const flipped = Buffer.from(sig, 'base64url');
flipped[0] ^= 1;
check('a bad signature is refused', await verdict(body, `${h}.${p}.${flipped.toString('base64url')}`), false);
check(
  'an expired key is refused',
  (await verifyPlaidWebhook(body, sign(body), async () => ({ ...jwk, expired_at: 1 }), NOW)).ok,
  false
);

check('new transactions sync', webhookAction({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE' }), { kind: 'sync' });
check(
  'an item error is recorded',
  webhookAction({ webhook_type: 'ITEM', webhook_code: 'ERROR', error: { error_code: 'ITEM_LOGIN_REQUIRED' } }),
  { kind: 'error', code: 'ITEM_LOGIN_REQUIRED' }
);
check('a pending expiry is recorded', webhookAction({ webhook_type: 'ITEM', webhook_code: 'PENDING_EXPIRATION' }), {
  kind: 'error',
  code: 'PENDING_EXPIRATION'
});
check('a repaired login clears it', webhookAction({ webhook_type: 'ITEM', webhook_code: 'LOGIN_REPAIRED' }), { kind: 'clear' });
check('anything else is ignored', webhookAction({ webhook_type: 'TRANSACTIONS', webhook_code: 'DEFAULT_UPDATE' }), {
  kind: 'ignore'
});

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
