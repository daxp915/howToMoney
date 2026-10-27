/**
 * One Plaid bank's share of a sync.
 *
 * `/transactions/sync` is a feed: from a saved cursor it returns what was
 * added, modified and removed since, in pages. All pages are read before
 * anything is written (Plaid's own advice -- a page boundary can split a
 * pending row from the posted row that replaces it), and the new cursor is
 * saved in the same database transaction as the rows, so a failure replays
 * from the old cursor rather than skipping data.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { plaidItems } from '../db/schema';
import { decryptSecret } from '../crypto';
import type { LedgerWriters } from '../sync/sync';
import type { ProviderTransaction } from '../sync/types';
import { PlaidError, transactionsSync, type PlaidAccount, type TransactionsSyncResponse } from './client';
import { mapAccount, mapTransaction } from './map';

type Item = typeof plaidItems.$inferSelect;

export interface PlaidItemResult {
  accounts: number;
  inserted: number;
  updated: number;
  reconciled: number;
  removed: number;
  /** Plaid's ids for every account the item still lists (for deactivating the rest). */
  accountIds: string[];
  /** A line for the run's error list, worded like SimpleFIN's institution errors. */
  error?: string;
}

async function readFeed(accessToken: string, cursor: string | null) {
  // Plaid restarts pagination when the data changes mid-read; three attempts
  // from the saved cursor is what its docs suggest before giving up.
  for (let attempt = 0; ; attempt++) {
    const pages: TransactionsSyncResponse[] = [];
    let next = cursor;
    try {
      for (;;) {
        const page = await transactionsSync(accessToken, next);
        pages.push(page);
        next = page.next_cursor;
        if (!page.has_more) break;
      }
      return { pages, cursor: next };
    } catch (e) {
      if (e instanceof PlaidError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 2) {
        continue;
      }
      throw e;
    }
  }
}

export async function syncPlaidItem(item: Item, ledger: LedgerWriters): Promise<PlaidItemResult> {
  const result: PlaidItemResult = { accounts: 0, inserted: 0, updated: 0, reconciled: 0, removed: 0, accountIds: [] };
  const bank = item.institutionName ?? 'A bank';

  let feed: Awaited<ReturnType<typeof readFeed>>;
  try {
    feed = await readFeed(decryptSecret(item.accessToken), item.cursor);
  } catch (e) {
    // ITEM_LOGIN_REQUIRED and friends: the bank needs the person, not a retry.
    // Kept on the item so Connections can offer Reconnect, and in the run's
    // errors so the connection banner sees it like any other bank failure.
    const code = e instanceof PlaidError ? e.code : 'UNREACHABLE';
    await db.update(plaidItems).set({ errorCode: code }).where(eq(plaidItems.id, item.id));
    const message = e instanceof Error ? e.message : String(e);
    return { ...result, error: `${bank}: ${message} [plaid ${code}]` };
  }

  // The last page's account list is the current one (balances included).
  const accountsById = new Map<string, PlaidAccount>();
  for (const page of feed.pages) for (const a of page.accounts) accountsById.set(a.account_id, a);

  const localId = new Map<string, string>();
  for (const a of accountsById.values()) {
    localId.set(a.account_id, await ledger.upsertAccount(mapAccount(a, item.institutionName)));
    result.accountIds.push(a.account_id);
    result.accounts++;
  }

  // Added and modified both carry the full row; the ledger tells new from known.
  const byAccount = new Map<string, ProviderTransaction[]>();
  for (const page of feed.pages) {
    for (const t of [...page.added, ...page.modified]) {
      const list = byAccount.get(t.account_id) ?? [];
      list.push(mapTransaction(t));
      byAccount.set(t.account_id, list);
    }
  }
  for (const [plaidAccountId, txns] of byAccount) {
    const accountId = localId.get(plaidAccountId);
    if (!accountId) continue; // an account Plaid no longer lists; its rows have nowhere to go
    // Pending rows first, so a posted row in the same batch finds the pending
    // one it replaces even when Plaid sent both at once.
    txns.sort((a, b) => Number(b.pending) - Number(a.pending));
    const res = await ledger.upsertTransactions(accountId, 'plaid', txns);
    result.inserted += res.inserted;
    result.updated += res.updated;
    result.reconciled += res.reconciled;
  }

  result.removed = await ledger.removeTransactions(
    'plaid',
    feed.pages.flatMap((p) => p.removed.map((r) => r.transaction_id))
  );

  await db
    .update(plaidItems)
    .set({ cursor: feed.cursor, errorCode: null, lastSyncedAt: new Date() })
    .where(eq(plaidItems.id, item.id));

  return result;
}
