// SimpleFIN Bridge client.
//
// Protocol: a one-time base64 "setup token" decodes to a claim URL. POSTing to
// that claim URL returns an access URL with HTTP basic credentials embedded.
// The access URL is long-lived and is the only secret we store.
// Docs: https://www.simplefin.org/protocol.html

export interface SimpleFinOrg {
  domain?: string;
  name?: string;
  'sfin-url'?: string;
}

export interface SimpleFinTransaction {
  id: string;
  posted: number; // epoch seconds
  amount: string; // decimal string, negative = money out
  description: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
  transacted_at?: number;
}

export interface SimpleFinAccount {
  org: SimpleFinOrg;
  id: string;
  name: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date': number;
  transactions?: SimpleFinTransaction[];
  holdings?: SimpleFinHolding[];
}

/** A position in an investment account. Every figure is a decimal string. */
export interface SimpleFinHolding {
  id: string;
  created?: number;
  currency?: string;
  symbol?: string;
  description?: string;
  shares: string;
  market_value: string;
  /** Average cost per share; "0.00" when the institution does not report it. */
  purchase_price?: string;
  cost_basis?: string;
}

export interface SimpleFinResponse {
  errors: string[];
  accounts: SimpleFinAccount[];
}

/**
 * How long to wait on the bridge before giving up.
 *
 * Node's `fetch` has no default timeout at all. Without this a bridge that
 * accepts the connection and then goes quiet holds the request open forever:
 * the sync never finishes, never fails, never writes a `finished_at`, and the
 * caller waits on a promise that will not settle. That is not hypothetical --
 * it is what leaves the dashboard's Sync button saying "Syncing…" after the
 * work is long dead.
 *
 * A real fetch of 89 days across several institutions takes tens of seconds, so
 * this is generous on purpose; it is a stall detector, not a latency budget.
 */
const FETCH_TIMEOUT_MS = Number(process.env.SIMPLEFIN_TIMEOUT_MS ?? 120_000);

/** Turns an aborted fetch into a sentence that says what to do about it. */
function describeNetworkFailure(e: unknown, what: string): Error {
  const name = e instanceof Error ? e.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new Error(
      `SimpleFIN did not respond within ${Math.round(FETCH_TIMEOUT_MS / 1000)}s while ${what}. ` +
        'The bridge may be down or an institution may be hanging; try again, and raise ' +
        'SIMPLEFIN_TIMEOUT_MS if your history is genuinely this slow.'
    );
  }
  return e instanceof Error ? e : new Error(String(e));
}

// Node's fetch ignores credentials embedded in a URL, so split them out and
// send an explicit Authorization header.
function splitCredentials(accessUrl: string): { url: URL; authHeader: string } {
  const url = new URL(accessUrl);
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  if (!user) throw new Error('SimpleFIN access URL is missing its credentials');
  url.username = '';
  url.password = '';
  const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  return { url, authHeader };
}

/** One-time: exchange a setup token for a long-lived access URL. */
export async function claimSetupToken(setupToken: string): Promise<string> {
  const claimUrl = Buffer.from(setupToken.trim(), 'base64').toString('utf8').trim();
  if (!/^https:\/\//.test(claimUrl)) {
    throw new Error('Setup token did not decode to an https claim URL');
  }
  let res: Response;
  try {
    res = await fetch(claimUrl, {
      method: 'POST',
      headers: { 'Content-Length': '0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
  } catch (e) {
    throw describeNetworkFailure(e, 'claiming the setup token');
  }
  if (!res.ok) {
    throw new Error(`Claim failed: ${res.status} ${res.statusText} ${await res.text()}`);
  }
  const accessUrl = (await res.text()).trim();
  if (!/^https:\/\//.test(accessUrl)) {
    throw new Error(`Claim returned an unexpected body: ${accessUrl.slice(0, 120)}`);
  }
  return accessUrl;
}

export interface FetchOptions {
  /** Inclusive lower bound. Defaults to 90 days back. */
  startDate?: Date;
  endDate?: Date;
  /** Include pending transactions. Worth it -- we reconcile them on posting. */
  pending?: boolean;
  /** Fetch balances only, skipping transactions. */
  balancesOnly?: boolean;
}

export async function fetchAccounts(
  accessUrl: string,
  opts: FetchOptions = {}
): Promise<SimpleFinResponse> {
  const { url, authHeader } = splitCredentials(accessUrl);
  const endpoint = new URL(url.toString().replace(/\/$/, '') + '/accounts');

  const start = opts.startDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  endpoint.searchParams.set('start-date', String(Math.floor(start.getTime() / 1000)));
  if (opts.endDate) {
    endpoint.searchParams.set('end-date', String(Math.floor(opts.endDate.getTime() / 1000)));
  }
  if (opts.pending !== false) endpoint.searchParams.set('pending', '1');
  if (opts.balancesOnly) endpoint.searchParams.set('balances-only', '1');

  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
  } catch (e) {
    throw describeNetworkFailure(e, 'fetching accounts');
  }

  if (res.status === 403) {
    throw new Error('SimpleFIN rejected the access URL (403). The connection may need re-auth.');
  }
  if (!res.ok) {
    throw new Error(`SimpleFIN request failed: ${res.status} ${res.statusText}`);
  }

  // The timeout covers the body too: a bridge that sends headers and then
  // stalls mid-payload hangs here otherwise, which looks identical to a hung
  // connection from the outside.
  let body: SimpleFinResponse;
  try {
    body = (await res.json()) as SimpleFinResponse;
  } catch (e) {
    throw describeNetworkFailure(e, 'reading the accounts response');
  }

  // SimpleFIN returns HTTP 200 with a populated `errors` array when an
  // individual institution fails. Surface it without discarding good accounts.
  if (body.errors?.length) {
    console.warn('[simplefin] institution errors:', body.errors);
  }
  return body;
}

export type AccountType = 'depository' | 'credit' | 'loan' | 'investment' | 'other';

/**
 * SimpleFIN carries no account-type field, so infer it. Type drives
 * credit-card-payment transfer matching, so getting it wrong means your card
 * payments never auto-pair.
 *
 * Product names are a weak signal in practice -- "Quicksilver" and "Freedom
 * Unlimited" are credit cards that contain no credit-card words, while
 * "Discover Bank Account" is a deposit account that contains a card brand. So
 * keywords are used only where they are unambiguous, and the balance sign
 * decides everything else: a liability carries a negative balance.
 */
export function inferAccountType(
  name: string,
  orgName?: string,
  balance?: string | number | null
): AccountType {
  const s = `${name} ${orgName ?? ''}`.toLowerCase();

  // Unambiguous lending language, plus captive finance arms (a carmaker's lender,
  // Ford Motor Credit) whose account names are just the vehicle.
  if (/\b(mortgage|loan|heloc|lease|refinance|student)\b/.test(s)) return 'loan';
  if (/\b(financial|motor credit|financial services|auto finance)\b/.test(s)) return 'loan';

  if (/\b(brokerage|invest|401k|ira|roth|hsa|vanguard|fidelity|schwab)\b/.test(s)) {
    return 'investment';
  }

  // Deposit words beat card-brand words: "Discover Bank Account" is a savings
  // account, not a Discover card.
  if (/\b(checking|chequing|savings|money market|cash management|certificate|cd)\b/.test(s)) {
    return 'depository';
  }

  if (/\b(credit card|card|visa|mastercard|amex|american express)\b/.test(s)) return 'credit';

  // Fallback: the balance sign is the most reliable signal SimpleFIN gives us.
  // Liabilities are reported negative; deposit accounts are not.
  const amount = balance === null || balance === undefined ? null : Number(balance);
  if (amount !== null && Number.isFinite(amount)) {
    if (amount < 0) return 'credit';
    if (amount > 0) return 'depository';
  }

  return 'other';
}
