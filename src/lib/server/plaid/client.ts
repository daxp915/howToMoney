/**
 * Plaid over plain fetch -- the few endpoints the app uses, no SDK.
 *
 * Every call carries a timeout (PLAID_TIMEOUT_MS, default 60s) covering the
 * request and the body read: Node's fetch has none, and a provider that
 * accepts the connection and goes quiet would hang a sync forever.
 *
 * Amounts here are Plaid's own convention -- positive means money LEFT the
 * account. Nothing in this file flips them; `map.ts` does, in one place.
 */

export type PlaidEnv = 'sandbox' | 'production';

const HOSTS: Record<PlaidEnv, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com'
};

export function plaidEnv(): PlaidEnv {
  return process.env.PLAID_ENV === 'production' ? 'production' : 'sandbox';
}

/** Plaid is optional: without both keys the app offers SimpleFIN only. */
export function plaidConfigured(): boolean {
  return !!process.env.PLAID_CLIENT_ID?.trim() && !!process.env.PLAID_SECRET?.trim();
}

export class PlaidError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly type: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!plaidConfigured()) throw new Error('Plaid is not configured: set PLAID_CLIENT_ID and PLAID_SECRET.');
  const timeout = Number(process.env.PLAID_TIMEOUT_MS ?? 60_000);
  let res: Response;
  let text: string;
  try {
    res = await fetch(HOSTS[plaidEnv()] + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!.trim(),
        'PLAID-SECRET': process.env.PLAID_SECRET!.trim(),
        'Plaid-Version': '2020-09-14'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    });
    text = await res.text();
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(`Plaid did not answer ${path} within ${Math.round(timeout / 1000)}s`);
    }
    throw new Error(`Could not reach Plaid (${path}): ${e instanceof Error ? e.message : String(e)}`);
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Plaid returned something that is not JSON from ${path} (HTTP ${res.status})`);
  }
  if (!res.ok || json.error_code) {
    throw new PlaidError(
      String(json.display_message || json.error_message || `HTTP ${res.status}`),
      String(json.error_code ?? 'UNKNOWN'),
      String(json.error_type ?? 'UNKNOWN'),
      res.status
    );
  }
  return json as T;
}

// ---- the shapes we read (Plaid sends more) --------------------------------

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: 'depository' | 'credit' | 'loan' | 'investment' | 'brokerage' | 'other';
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    iso_currency_code: string | null;
    last_updated_datetime?: string | null;
  };
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  /** Positive = money out of the account. */
  amount: number;
  iso_currency_code: string | null;
  /** YYYY-MM-DD: posted date, or the transaction date while pending. */
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  original_description?: string | null;
  pending: boolean;
  /** On a posted row: the pending row it replaces. */
  pending_transaction_id: string | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
}

export interface TransactionsSyncResponse {
  accounts: PlaidAccount[];
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: Array<{ transaction_id: string; account_id?: string }>;
  next_cursor: string;
  has_more: boolean;
}

// ---- endpoints ----------------------------------------------------------

/** A short-lived token that opens Plaid Link in the browser for one user. */
export async function createLinkToken(userId: string, opts: { accessToken?: string; webhook?: string } = {}) {
  const res = await call<{ link_token: string; expiration: string }>('/link/token/create', {
    client_name: 'howToMoney',
    language: 'en',
    country_codes: ['US'],
    user: { client_user_id: userId },
    // Update mode (re-entering a bank password) passes the item's token and no products.
    ...(opts.accessToken
      ? { access_token: opts.accessToken }
      : { products: ['transactions'], transactions: { days_requested: 730 } }),
    ...((opts.webhook ?? plaidWebhookUrl()) ? { webhook: opts.webhook ?? plaidWebhookUrl() } : {})
  });
  return res.link_token;
}

export async function exchangePublicToken(publicToken: string) {
  return call<{ access_token: string; item_id: string }>('/item/public_token/exchange', {
    public_token: publicToken
  });
}

/** One page of the transaction feed after `cursor` (null = from the beginning). */
export async function transactionsSync(accessToken: string, cursor: string | null) {
  return call<TransactionsSyncResponse>('/transactions/sync', {
    access_token: accessToken,
    count: 500,
    ...(cursor ? { cursor } : {})
  });
}

/** A key Plaid signs webhooks with (`/webhook_verification_key/get`). */
export interface PlaidJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid: string;
  alg: string;
  created_at: number;
  expired_at: number | null;
}

export async function webhookVerificationKey(kid: string): Promise<PlaidJwk> {
  const res = await call<{ key: PlaidJwk }>('/webhook_verification_key/get', { key_id: kid });
  return res.key;
}

/**
 * Where Plaid should send this server's webhooks (`PLAID_WEBHOOK_URL`, the
 * public address of `/api/plaid/webhook`). Unset means no webhooks: the
 * worker's schedule still syncs, only later.
 */
export function plaidWebhookUrl(): string | undefined {
  return process.env.PLAID_WEBHOOK_URL?.trim() || undefined;
}

/** Points an existing item at the webhook URL (items linked before it was set). */
export async function itemWebhookUpdate(accessToken: string, webhook: string) {
  await call('/item/webhook/update', { access_token: accessToken, webhook });
}

/** Sandbox only: asks Plaid to send a webhook for an item now. */
export async function sandboxFireWebhook(accessToken: string, code = 'SYNC_UPDATES_AVAILABLE') {
  if (plaidEnv() !== 'sandbox') throw new Error('sandboxFireWebhook() only works with PLAID_ENV=sandbox');
  await call('/sandbox/item/fire_webhook', { access_token: accessToken, webhook_code: code });
}

/** Revokes the access token at Plaid. Billing for the item stops here. */
export async function removeItem(accessToken: string) {
  await call('/item/remove', { access_token: accessToken });
}

/** Sandbox only: a connected test bank without the browser flow. */
export async function sandboxPublicToken(institutionId = 'ins_109508') {
  if (plaidEnv() !== 'sandbox') throw new Error('sandboxPublicToken() only works with PLAID_ENV=sandbox');
  const res = await call<{ public_token: string }>('/sandbox/public_token/create', {
    institution_id: institutionId,
    initial_products: ['transactions']
  });
  return res.public_token;
}
