import { fail } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts, importBatches, plaidItems, providerCredentials, syncRuns } from '$lib/server/db/schema';
import { claimToken } from '$lib/server/simplefin/claim';
import { plaidConfigured } from '$lib/server/plaid/client';
import { disconnectPlaidItem } from '$lib/server/plaid/items';
import { loadConnectionIssues } from '$lib/server/connectionHealth';
import { accountDisplayName, institutionName, lastFour } from '$lib/accountName';
import type { Actions, PageServerLoad } from './$types';

/**
 * Each person connects their own SimpleFIN bridge here.
 *
 * Their bank credentials never reach this box: they log into their banks at
 * SimpleFIN, and what gets pasted below is a one-time setup token that this
 * server exchanges for a read-only access URL. That URL is then encrypted at
 * rest, under the current user's row, so one person's connection is unreachable
 * from another's session even if a query forgets to scope.
 */

export const load: PageServerLoad = async ({ locals }) => {
  // Row-level security scopes all of these to the signed-in user.
  const [credential] = await db
    .select({ id: providerCredentials.id, createdAt: providerCredentials.createdAt })
    .from(providerCredentials)
    .where(eq(providerCredentials.provider, 'simplefin'))
    .limit(1);

  const linked = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      nickname: accounts.nickname,
      orgName: accounts.orgName,
      type: accounts.type,
      provider: accounts.provider,
      isActive: accounts.isActive,
      balance: accounts.balance,
      lastSyncedAt: accounts.lastSyncedAt
    })
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .orderBy(accounts.type, accounts.name);

  // Grouped by bank, since that is what actually syncs. A bank
  // needs the person when `connectionIssues()` names it -- the same list the
  // banner and the avatar dot read.
  const issues = await loadConnectionIssues();
  const flagged = new Set(issues.map((x) => x.bank?.toLowerCase()).filter(Boolean));
  const banks = new Map<string, { name: string; accounts: typeof shown; syncedAt: Date | null; stale: boolean; manual: boolean }>();
  const shown = linked.map((a) => ({
    id: a.id,
    type: a.type,
    name: accountDisplayName(a, locals.user?.email),
    last4: lastFour(a.name),
    balance: Number(a.balance ?? 0),
    manual: a.provider === 'manual',
    syncedAt: a.lastSyncedAt
  }));
  for (const [i, a] of linked.entries()) {
    // Plaid banks are listed from their items below, one row per connection.
    if (a.provider === 'plaid') continue;
    const key = a.provider === 'manual' ? 'Entered by hand' : institutionName(a.orgName) || 'Other';
    const b = banks.get(key) ?? { name: key, accounts: [], syncedAt: null, stale: false, manual: a.provider === 'manual' };
    b.accounts.push(shown[i]);
    if (a.lastSyncedAt && (!b.syncedAt || a.lastSyncedAt > b.syncedAt)) b.syncedAt = a.lastSyncedAt;
    if (a.provider !== 'manual' && flagged.has(key.toLowerCase())) b.stale = true;
    banks.set(key, b);
  }

  const [lastSync] = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1);
  const [lastImport] = await db
    .select({
      id: importBatches.id,
      filename: importBatches.filename,
      createdAt: importBatches.createdAt,
      imported: importBatches.importedCount,
      duplicates: importBatches.duplicateCount,
      status: importBatches.status
    })
    .from(importBatches)
    .orderBy(desc(importBatches.createdAt))
    .limit(1);

  // One row per Plaid connection, with its own sign-in state.
  const items = await db
    .select({
      id: plaidItems.id,
      name: plaidItems.institutionName,
      errorCode: plaidItems.errorCode,
      syncedAt: plaidItems.lastSyncedAt
    })
    .from(plaidItems)
    .orderBy(plaidItems.createdAt);
  const plaid = items.map((it) => ({
    ...it,
    name: it.name ?? 'A bank',
    accounts: linked.filter((a) => a.provider === 'plaid' && a.orgName === it.name).length
  }));

  // : one SimpleFIN list, a stale bank tagged in place and given a
  // card of its own below; accounts entered by hand are not SimpleFIN's.
  const all = [...banks.values()];
  return {
    plaidEnabled: plaidConfigured(),
    plaid,
    credential: credential ?? null,
    banks: all.filter((b) => !b.manual),
    manual: all.find((b) => b.manual) ?? null,
    accountCount: shown.length,
    lastSync: lastSync ?? null,
    issues,
    lastImport: lastImport ?? null
  };
};

export const actions: Actions = {
  /** "Use a new setup token", or the first one. Replaces the stored URL. */
  claim: async ({ request }) => {
    const token = String((await request.formData()).get('token') ?? '');
    const r = await claimToken(token, 'connected from the app');
    if (!r.ok) return fail(400, { token, tokenError: { message: r.message, newToken: r.newToken } });
    return { success: true, connected: r.accounts };
  },

  disconnect: async () => {
    // Removes the stored credential only. Accounts and transactions stay, so a
    // reconnect does not re-import everything and history is never lost by
    // accident.
    await db.delete(providerCredentials).where(eq(providerCredentials.provider, 'simplefin'));
    return { success: true, disconnected: true };
  },

  /** Stops one Plaid bank: revoked at Plaid (billing stops), accounts kept but inactive. */
  plaidRemove: async ({ request }) => {
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { plaidError: 'Which bank?' });
    await disconnectPlaidItem(id);
    return { success: true, plaidRemoved: true };
  }
};
