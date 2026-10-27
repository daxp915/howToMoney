import { and, desc, eq } from 'drizzle-orm';
import { db } from './db';
import { accounts, plaidItems, providerCredentials, syncRuns } from './db/schema';
import { connectionIssues, type ConnectionIssue } from '../connectionHealth';
import { institutionName } from '../accountName';

/**
 * The inputs for `connectionIssues()`, for the signed-in user (row-level
 * security scopes every query). Three small reads: the layout calls this on
 * every page so a broken connection is never more than one page away.
 */
export async function loadConnectionIssues(now = new Date()): Promise<ConnectionIssue[]> {
  return (await loadConnectionHealth(now)).issues;
}

/** The issues, plus what an alert email lists: each bank, and when the last clean sync ran. */
export async function loadConnectionHealth(
  now = new Date()
): Promise<{ issues: ConnectionIssue[]; banks: string[]; lastSync: Date | null }> {
  const [credential, plaid, runs, fed] = await Promise.all([
    db
      .select({ id: providerCredentials.id })
      .from(providerCredentials)
      .where(eq(providerCredentials.provider, 'simplefin'))
      .limit(1),
    db
      .select({
        id: plaidItems.id,
        bank: plaidItems.institutionName,
        errorCode: plaidItems.errorCode,
        lastGood: plaidItems.lastSyncedAt
      })
      .from(plaidItems),
    db
      .select({ startedAt: syncRuns.startedAt, finishedAt: syncRuns.finishedAt, status: syncRuns.status, error: syncRuns.error })
      .from(syncRuns)
      .orderBy(desc(syncRuns.startedAt))
      .limit(40),
    db
      .select({ orgName: accounts.orgName, balanceDate: accounts.balanceDate })
      .from(accounts)
      .where(and(eq(accounts.isActive, true), eq(accounts.provider, 'simplefin')))
  ]);
  // A SimpleFIN URL in the environment is imported on the next sync, so it
  // counts as a connection until then.
  // The env URL no longer counts: it is the server owner's, imported into the
  // table on their first sync, and must not make another household look connected.
  const hasCredential = credential.length > 0 || plaid.length > 0;
  const banks = [...new Set(fed.map((a) => institutionName(a.orgName) || 'A bank'))].sort();
  const lastSync = runs.find((r) => r.finishedAt && r.status !== 'failed')?.startedAt ?? null;
  const failing = plaid.flatMap((p) =>
    p.errorCode ? [{ id: p.id, bank: p.bank ?? 'A bank', errorCode: p.errorCode, lastGood: p.lastGood }] : []
  );
  for (const p of plaid) if (p.bank) banks.push(p.bank);
  return {
    issues: connectionIssues({ now, hasCredential, runs, accounts: fed, plaid: failing }),
    banks: [...new Set(banks)].sort(),
    lastSync
  };
}
