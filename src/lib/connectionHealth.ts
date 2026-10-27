import { institutionName } from './accountName';

/**
 * Is anything between the bank and this app broken, and what does the person
 * do about it?
 *
 * A connection used to count as broken only when an account had not been
 * written for three days. SimpleFIN keeps returning an account whose bank
 * sign-in has failed -- with the old balance -- so the app rewrote it every
 * six hours and Harbor Auto Finance failed for days with nothing on screen but
 * a line in `sync_runs.error`. This reads every signal there is: what the
 * provider said on the last run, whether the run itself failed and why,
 * whether runs are happening at all, and the bank's own balance date.
 *
 * Pure, so `npm run test:health` covers it; `$lib/server/connectionHealth`
 * loads the inputs.
 */

/**
 * SimpleFIN's date-range warnings ("exceeds recommended range of 45 days")
 * arrive in `errors` beside real institution failures but are not failures:
 * every account still answered in full.
 */
export const isAdvisory = (e: string) => /exceeds (recommended|limit)/i.test(e);

export interface HealthRun {
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  error: string | null;
}

export interface HealthInput {
  now: Date;
  /** A SimpleFIN access URL is stored. */
  hasCredential: boolean;
  /** Recent sync runs, newest first. */
  runs: HealthRun[];
  /** Active accounts SimpleFIN feeds. */
  accounts: { orgName: string | null; balanceDate: Date | null }[];
  /** Plaid banks whose last sync failed, with Plaid's error code. */
  plaid?: { id: string; bank: string; errorCode: string; lastGood: Date | null }[];
}

/**
 * Plaid codes that need the person to sign in at the bank again, through
 * Link's update mode (the Reconnect button). Anything else is Plaid's or the
 * bank's to clear.
 */
const PLAID_SIGN_IN = new Set([
  'ITEM_LOGIN_REQUIRED',
  'PENDING_EXPIRATION',
  'PENDING_DISCONNECT',
  'INVALID_CREDENTIALS',
  'INVALID_MFA',
  'USER_SETUP_REQUIRED',
  'ITEM_LOCKED',
  'ACCESS_NOT_GRANTED'
]);

/**
 * Where the fix happens: at SimpleFIN (a bank sign-in), a new setup token
 * here, nothing but time (the provider is down), or the person running the
 * server (worker stopped, key changed).
 */
export type Fix = 'simplefin' | 'token' | 'wait' | 'admin' | 'plaid';

export interface ConnectionIssue {
  /** Stable while the problem is the same one; a new key re-shows the banner. */
  key: string;
  /** The bank, when the problem is one bank's. */
  bank: string | null;
  title: string;
  detail: string;
  since: Date | null;
  /** The last time this connection was known good: the clean run before it, or the bank's last data. */
  lastGood: Date | null;
  fix: Fix;
}

const HOUR = 36e5;
const DAY = 864e5;
/** The worker syncs every 6 hours; a day without a run means it is not running. */
const NO_SYNC_AFTER = 26 * HOUR;
/** SimpleFIN refreshes a bank about once a day. Four days without new data is not a slow day. */
const STALE_AFTER = 4 * DAY;

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);

const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** One provider message per institution, as SimpleFIN writes them. */
function bankOf(message: string): { bank: string | null; rest: string } {
  const m = /^\s*Connection to (.+?) (?:may need attention|needs attention|is (?:down|unavailable)|failed)\.?\s*(.*)$/i.exec(message);
  if (m) return { bank: institutionName(m[1]) || m[1], rest: m[2] || '' };
  return { bank: null, rest: message };
}

/** The pieces of a run's `error` column (runSync joins them with "; "). */
const messages = (run: HealthRun) =>
  (run.error ?? '')
    .split(/;\s+/)
    .map((s) => s.trim())
    // Plaid failures are read from the item itself (`plaid` input), which
    // knows which bank and which code; the run's copy would be a second issue.
    .filter((s) => s && !isAdvisory(s) && !/\[plaid [A-Z_]+\]$/.test(s));

function failedRun(error: string): Pick<ConnectionIssue, 'key' | 'title' | 'detail' | 'fix'> & { transient: boolean } {
  if (/\b(401|403)\b|forbidden|unauthori[sz]ed|revoked|access url/i.test(error))
    return {
      key: 'access',
      title: 'SimpleFIN no longer accepts this connection',
      detail: 'The access was revoked or expired at SimpleFIN, so no bank can update. Make a new setup token there and paste it here.',
      fix: 'token',
      transient: false
    };
  if (/decrypt|ENCRYPTION_KEY|unsupported state|bad decrypt|auth tag/i.test(error))
    return {
      key: 'key',
      title: 'The stored bank connection cannot be read',
      detail: 'The server’s ENCRYPTION_KEY no longer matches the one it was saved with. Restore the key, or paste a new SimpleFIN setup token.',
      fix: 'admin',
      transient: false
    };
  if (/did not respond|time(d)? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket|\b5\d\d\b/i.test(error))
    return {
      key: 'down',
      title: 'SimpleFIN is not answering',
      detail: 'The last syncs could not reach SimpleFIN. It usually comes back on its own; nothing here needs changing.',
      fix: 'wait',
      transient: true
    };
  return {
    key: 'failed',
    title: 'Syncing is failing',
    detail: error,
    fix: 'admin',
    transient: false
  };
}

export function connectionIssues(i: HealthInput): ConnectionIssue[] {
  const out: ConnectionIssue[] = [];

  if (!i.hasCredential) {
    if (i.accounts.length)
      out.push({
        key: 'no-credential',
        bank: null,
        title: 'Bank sync is disconnected',
        detail: 'No SimpleFIN connection is stored, so none of your accounts update. Paste a setup token to reconnect; your history stays.',
        since: null,
        lastGood: null,
        fix: 'token'
      });
    return out;
  }

  const finished = i.runs.filter((r) => r.finishedAt);
  const newest = i.runs[0];

  // Runs are not happening at all.
  if (newest && i.now.getTime() - newest.startedAt.getTime() > NO_SYNC_AFTER) {
    out.push({
      key: 'no-sync',
      bank: null,
      title: `No sync since ${day(newest.startedAt)}`,
      detail: 'The background sync has stopped running, so balances and transactions are out of date. The worker container needs a restart.',
      since: newest.startedAt,
      lastGood: newest.startedAt,
      fix: 'admin'
    });
  }

  // The run itself failed: nothing updated. A network blip fails one run and
  // the next succeeds, so a transient cause waits for a second failure.
  const last = finished[0];
  if (last?.status === 'failed') {
    const streak = finished.findIndex((r) => r.status !== 'failed');
    const failures = finished.slice(0, streak === -1 ? finished.length : streak);
    const f = failedRun(last.error ?? 'The sync stopped without saying why.');
    if (!f.transient || failures.length >= 2) {
      const good = streak === -1 ? null : finished[streak].startedAt;
      out.push({ key: f.key, bank: null, title: f.title, detail: f.detail, fix: f.fix, since: failures.at(-1)!.startedAt, lastGood: good });
    }
  }

  // One bank failing inside an otherwise good run.
  const flagged = new Set<string>();
  const lastAnswered = finished.find((r) => r.status !== 'failed');
  for (const msg of lastAnswered ? messages(lastAnswered) : []) {
    const { bank, rest } = bankOf(msg);
    const signIn = /credential|password|log ?in|sign ?in|re-?authenticat|mfa|verification/i.test(msg);
    // How long: back through the runs while each one still reported it.
    let since = lastAnswered!.startedAt;
    let lastGood: Date | null = null;
    for (const r of finished) {
      if (r.startedAt > lastAnswered!.startedAt || r.status === 'failed') continue;
      if (!messages(r).includes(msg)) {
        lastGood = r.startedAt;
        break;
      }
      since = r.startedAt;
    }
    if (bank) flagged.add(bank.toLowerCase());
    out.push({
      key: `bank-${slug(bank ?? msg)}`,
      bank,
      title: bank
        ? signIn
          ? `${bank} needs you to sign in again`
          : `${bank} is not syncing`
        : 'A bank is not syncing',
      detail: (rest || msg) + (signIn ? ' Update the sign-in at SimpleFIN, then sync here.' : ''),
      since,
      lastGood,
      fix: 'simplefin'
    });
  }

  // A bank nobody complained about whose data has simply stopped moving.
  // Skipped while every run is failing: that issue already explains it.
  if (last?.status !== 'failed') {
    const newestByBank = new Map<string, Date | null>();
    for (const a of i.accounts) {
      const bank = institutionName(a.orgName) || 'A bank';
      const prev = newestByBank.get(bank);
      if (prev === undefined || (a.balanceDate && (!prev || a.balanceDate > prev))) newestByBank.set(bank, a.balanceDate);
    }
    for (const [bank, d] of newestByBank) {
      if (!d || flagged.has(bank.toLowerCase())) continue;
      const age = i.now.getTime() - d.getTime();
      if (age <= STALE_AFTER) continue;
      out.push({
        key: `stale-${slug(bank)}`,
        bank,
        title: `${bank} has not updated since ${day(d)}`,
        detail: `SimpleFIN has had no new data from ${bank} for ${Math.floor(age / DAY)} days. That usually means the sign-in there needs renewing.`,
        since: d,
        lastGood: d,
        fix: 'simplefin'
      });
    }
  }

  // A Plaid bank keeps its own error code until a sync succeeds again.
  for (const p of i.plaid ?? []) {
    const signIn = PLAID_SIGN_IN.has(p.errorCode);
    out.push({
      key: `plaid-${slug(p.bank)}-${p.errorCode.toLowerCase()}`,
      bank: p.bank,
      title: signIn ? `${p.bank} needs you to sign in again` : `${p.bank} is not syncing`,
      detail: signIn
        ? `${p.bank} asked to confirm it is you before sharing new transactions. Press Reconnect and sign in; your history stays.`
        : `Plaid could not reach ${p.bank} (${p.errorCode}). It usually clears on its own; Reconnect if it keeps happening.`,
      since: null,
      lastGood: p.lastGood,
      fix: signIn ? 'plaid' : 'wait'
    });
  }

  return out;
}

/** Set by the banner's "Hide for today" (24 hours), holding the signature below. */
export const SNOOZE_COOKIE = 'conn_snooze';

/** The banner's dismissal cookie holds this; any new problem changes it. */
export const issuesSignature = (issues: ConnectionIssue[]) =>
  issues
    .map((x) => x.key)
    .sort()
    .join('.');
