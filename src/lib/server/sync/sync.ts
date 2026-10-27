import { and, eq, gte, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { currentUserId, db, runAsUser } from '../db';
import { accountBalances, accounts, holdingSnapshots, plaidItems, syncRuns, transactions } from '../db/schema';
import { fetchAccounts } from '../simplefin/client';
import { getSimpleFinAccessUrl, hasStoredCredentials } from '../simplefin/credentials';
import * as simplefin from '../simplefin/map';
import { syncPlaidItem } from '../plaid/sync';
import type { Provider, ProviderAccount, ProviderHolding, ProviderTransaction } from './types';
import { matchTransfers } from '../matching/transfers';
import { detectRecurring } from '../matching/recurring';
import { backfillSubscriptionFlags, categorizePending } from '../ai/categorize';
import { fromCents, normalizeDescription, toCents } from './normalize';
import { isAdvisory } from '../../connectionHealth';

const DAY_MS = 24 * 60 * 60 * 1000;


// How far back a pending transaction may drift before it posts. Used to pair a
// newly posted transaction with the pending row it replaces.
const PENDING_RECONCILE_DAYS = 6;

// A pending row that has neither posted nor reappeared in this window never
// happened (a hold that dropped off) and is removed.
const PENDING_STALE_DAYS = 14;

// A newly arriving row older than this lands already reviewed (see the insert).
const HISTORY_REVIEWED_DAYS = 14;

export interface SyncOptions {
  /**
   * Whose ledger to sync. Omit only when already inside that user's scope --
   * a page request, for instance. The worker always passes it, because it
   * iterates every user who has a bank connection.
   */
  userId?: string;
  /** How much history to pull. Use ~730 for the initial backfill. */
  days?: number;
  /** Skip the LLM layer (useful for a fast balance-only refresh). */
  skipCategorize?: boolean;
}

export interface SyncSummary {
  runId: string;
  accountsSynced: number;
  inserted: number;
  updated: number;
  reconciledPending: number;
  transfersMatched: number;
  transfersQueued: number;
  recurringDetected: number;
  deactivated: number;
  categorized: number;
  aiCostUsd: number;
  errors: string[];
}

export async function runSync(opts: SyncOptions = {}): Promise<SyncSummary> {
  // Every query below is scoped by row-level security to one user. When a
  // caller names the user, open that scope here; otherwise we are already in
  // one, and nesting would rewrite the outer transaction's app.user_id.
  if (opts.userId && currentUserId() !== opts.userId) {
    const { userId, ...rest } = opts;
    return runAsUser(userId, () => runSync(rest));
  }

  if (!currentUserId()) {
    throw new Error(
      'runSync() needs a user: pass { userId } or call it inside runAsUser(). ' +
        'Without a scope, row-level security hides every row and the sync would ' +
        'silently do nothing.'
    );
  }


  // SimpleFIN rejects ranges longer than 90 days ("Requested date range exceeds
  // limit of 90 days and was capped"), so clamp client-side rather than let
  // every sync come back flagged with a provider error. Raise
  // SIMPLEFIN_MAX_DAYS if your bridge plan allows a longer window.
  const maxDays = Number(process.env.SIMPLEFIN_MAX_DAYS ?? 89);
  const requested = opts.days ?? 89;
  const days = Math.min(requested, maxDays);
  if (requested > days) {
    console.warn(
      `[sync] requested ${requested} days; SimpleFIN allows ${days}. ` +
        'Older history has to be imported from CSV/OFX.'
    );
  }
  // Written before anything can fail, so every failure -- even a credential
  // that cannot be read -- leaves a row the connection alerts can see. A
  // scheduled run that threw before this existed failed without a trace.
  const [run] = await db.insert(syncRuns).values({}).returning({ id: syncRuns.id });

  const summary: SyncSummary = {
    runId: run.id,
    accountsSynced: 0,
    inserted: 0,
    updated: 0,
    reconciledPending: 0,
    transfersMatched: 0,
    transfersQueued: 0,
    recurringDetected: 0,
    deactivated: 0,
    categorized: 0,
    aiCostUsd: 0,
    errors: []
  };

  try {
    // A household may have SimpleFIN, Plaid banks, or both. With neither,
    // getSimpleFinAccessUrl() decides: the single-user env fallback, or the
    // "no credentials" error. A household with Plaid banks and no stored
    // SimpleFIN credential never reaches the env URL -- that is the server
    // owner's bank, not theirs.
    const items = await db.select().from(plaidItems);
    const hasSimpleFin = (await hasStoredCredentials()) || !items.length;

    if (hasSimpleFin) await syncSimpleFin(days, summary);

    const plaidReturned: string[] = [];
    let plaidClean = items.length > 0;
    for (const item of items) {
      const res = await syncPlaidItem(item, { upsertAccount, upsertTransactions, removeTransactions });
      summary.inserted += res.inserted;
      summary.updated += res.updated;
      summary.reconciledPending += res.reconciled;
      summary.accountsSynced += res.accounts;
      if (res.error) summary.errors.push(res.error);
      // An item that failed, or listed nothing, says nothing about which of its
      // accounts still exist.
      if (res.error || !res.accountIds.length) plaidClean = false;
      plaidReturned.push(...res.accountIds);
    }
    // Same rule as SimpleFIN's: an account no item lists any more (closed, or
    // unticked when the person re-linked) leaves net worth. Accounts carry no
    // item id, so this waits for every item to answer cleanly -- deactivating
    // on a partial list would drop live accounts.
    if (plaidClean) summary.deactivated += await deactivateMissing('plaid', plaidReturned);

    // Order matters: transfers are settled before categorization so the LLM is
    // never asked to categorize a credit card payment it would call "Shopping".
    const transfers = await matchTransfers();
    summary.transfersMatched = transfers.matched;
    summary.transfersQueued = transfers.queuedForReview;

    // Answers the subscription question for merchants learned before it existed.
    // A no-op once every merchant has been asked.
    if (!opts.skipCategorize) await backfillSubscriptionFlags(200);

    // Cheap, deterministic, and only meaningful once transfers are settled.
    const recurring = await detectRecurring();
    summary.recurringDetected = recurring.detected;

    if (!opts.skipCategorize) {
      const cat = await categorizePending();
      summary.categorized = cat.byRule + cat.byMemory + cat.byAi;
      summary.aiCostUsd = cat.usage.costUsd;

      await db
        .update(syncRuns)
        .set({
          aiCalls: cat.usage.calls,
          aiCostUsd: cat.usage.costUsd.toFixed(4)
        })
        .where(eq(syncRuns.id, run.id));
    }

    await db
      .update(syncRuns)
      .set({
        finishedAt: new Date(),
        // An advisory alone is a clean run. Flagging it made the dashboard say
        // "some accounts didn't answer" after every manual sync while every
        // account had answered.
        status: summary.errors.some((e) => !isAdvisory(e)) ? 'completed_with_errors' : 'completed',
        accountsSynced: summary.accountsSynced,
        txnsInserted: summary.inserted,
        txnsUpdated: summary.updated,
        transfersMatched: summary.transfersMatched,
        error: summary.errors.length ? summary.errors.join('; ') : null
      })
      .where(eq(syncRuns.id, run.id));

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), status: 'failed', error: message })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}

async function syncSimpleFin(days: number, summary: SyncSummary): Promise<void> {
  // Encrypted in the database, with the env var honoured once and imported.
  const accessUrl = await getSimpleFinAccessUrl();
  const payload = await fetchAccounts(accessUrl, {
    startDate: new Date(Date.now() - days * DAY_MS),
    pending: true
  });
  summary.errors.push(...(payload.errors ?? []));

  for (const sfAccount of payload.accounts) {
    const accountId = await upsertAccount(simplefin.mapAccount(sfAccount));
    const res = await upsertTransactions(
      accountId,
      'simplefin',
      (sfAccount.transactions ?? []).map(simplefin.mapTransaction)
    );
    summary.inserted += res.inserted;
    summary.updated += res.updated;
    summary.reconciledPending += res.reconciled;
    summary.accountsSynced++;
  }

  // An account the provider no longer returns has been disconnected on their
  // side. Leaving it active keeps a frozen balance in net worth forever --
  // which is how a duplicate connection to one credit card silently doubles
  // your debt. Deactivate rather than delete: the transaction history stays
  // intact and reactivating is one UPDATE.
  //
  // Gated on a clean payload. The date-range messages are advisory, not
  // failures, so they do not block this; a real error might mean a truncated
  // account list, and deactivating on that would be destructive.
  const returnedIds = payload.accounts.map((a) => a.id);
  const advisoryOnly = summary.errors.every(isAdvisory);
  if (returnedIds.length && advisoryOnly) {
    summary.deactivated += await deactivateMissing('simplefin', returnedIds);
  }
}

/** Deactivates `provider`'s active accounts whose ids are not in `returnedIds`. */
async function deactivateMissing(provider: Provider, returnedIds: string[]): Promise<number> {
  const orphaned = await db
    .update(accounts)
    .set({ isActive: false })
    .where(
      and(
        eq(accounts.provider, provider),
        eq(accounts.isActive, true),
        notInArray(accounts.providerAccountId, returnedIds)
      )
    )
    .returning({ id: accounts.id, name: accounts.name });
  for (const o of orphaned) console.log(`[sync] deactivated disconnected account: ${o.name}`);
  return orphaned.length;
}

async function upsertAccount(a: ProviderAccount): Promise<string> {
  const [row] = await db
    .insert(accounts)
    .values({
      provider: a.provider,
      providerAccountId: a.providerAccountId,
      orgName: a.orgName,
      name: a.name,
      type: a.type,
      currency: a.currency,
      balance: a.balance,
      availableBalance: a.availableBalance,
      balanceDate: a.balanceDate,
      lastSyncedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [accounts.userId, accounts.provider, accounts.providerAccountId],
      // `name`, `type` and `nickname` are intentionally not overwritten -- the
      // inferred type and any user rename must survive a resync.
      // `is_active` back on: the provider returning an account is the evidence
      // it exists (a bank disconnected and linked again, a SimpleFIN account
      // that came back). Nothing else sets it false but a provider dropping it.
      set: {
        balance: a.balance,
        availableBalance: a.availableBalance,
        balanceDate: a.balanceDate,
        orgName: a.orgName,
        isActive: true,
        lastSyncedAt: new Date()
      }
    })
    .returning({ id: accounts.id });

  await snapshotBalance(row.id, a.balance);
  await snapshotHoldings(row.id, a.holdings);

  return row.id;
}

/**
 * One balance per account per day.
 *
 * An investment account's worth changes without a single transaction being
 * written, so its history cannot be reconstructed from the ledger afterwards --
 * if today's number is not recorded today, it is gone. Several syncs in a day
 * overwrite the same row rather than stacking up, so the series stays one point
 * per calendar day, and `current_date` is evaluated by Postgres so every row
 * lands on the database's own day boundary rather than the container's.
 */
async function snapshotBalance(accountId: string, balance: string | null): Promise<void> {
  if (balance === null || balance === undefined) return;

  await db
    .insert(accountBalances)
    .values({ accountId, asOf: sql`current_date`, balance })
    .onConflictDoUpdate({
      target: [accountBalances.userId, accountBalances.accountId, accountBalances.asOf],
      set: { balance }
    });
}

/**
 * Today's positions for one account, replacing whatever an earlier sync today
 * wrote for it. Replacing rather than upserting is what lets a position sold
 * since the morning disappear; an absent `holdings` field (as opposed to an
 * empty list) leaves the day alone, because it says nothing either way.
 */
async function snapshotHoldings(accountId: string, holdings: ProviderHolding[] | undefined) {
  if (!Array.isArray(holdings)) return;

  const byKey = new Map<string, typeof holdingSnapshots.$inferInsert>();
  for (const h of holdings) {
    const prev = byKey.get(h.key);
    if (prev) {
      // Two lots of one fund. Shares and value add; a weighted average cost
      // would need both lots' prices, and dropping to null is safer than a
      // wrong basis.
      prev.shares = (Number(prev.shares) + Number(h.shares)).toFixed(6);
      prev.marketValue = fromCents(toCents(prev.marketValue) + toCents(h.marketValue));
      if (prev.purchasePrice !== h.purchasePrice) prev.purchasePrice = null;
      continue;
    }
    byKey.set(h.key, {
      accountId,
      asOf: sql`current_date` as unknown as string,
      holdingKey: h.key,
      symbol: h.symbol,
      description: h.description,
      shares: h.shares,
      marketValue: h.marketValue,
      purchasePrice: h.purchasePrice,
      currency: h.currency
    });
  }

  await db
    .delete(holdingSnapshots)
    .where(and(eq(holdingSnapshots.accountId, accountId), eq(holdingSnapshots.asOf, sql`current_date`)));
  if (byKey.size) await db.insert(holdingSnapshots).values([...byKey.values()]);
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  reconciled: number;
}

async function upsertTransactions(
  accountId: string,
  provider: Provider,
  incoming: ProviderTransaction[]
): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, reconciled: 0 };
  if (!incoming.length) return result;

  const incomingIds = incoming.map((t) => t.providerTxnId);
  const existing = await db
    .select({ id: transactions.id, providerTxnId: transactions.providerTxnId })
    .from(transactions)
    .where(
      and(eq(transactions.accountId, accountId), inArray(transactions.providerTxnId, incomingIds))
    );
  const existingIds = new Set(existing.map((e) => e.providerTxnId));

  // A transaction that posts arrives under a brand new id while the old
  // pending row still sits in the ledger. Plaid says which pending row it
  // replaces; SimpleFIN has no `pending_transaction_id`, so there it is
  // reconciled by shape. Either way the pending row is promoted before
  // inserting, or every pending charge double-counts.
  const openPending = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      postedAt: transactions.postedAt,
      providerTxnId: transactions.providerTxnId
    })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), eq(transactions.pending, true)));

  const claimedPending = new Set<string>();

  for (const t of incoming) {
    const postedAt = t.postedAt;
    const values = {
      accountId,
      provider,
      providerTxnId: t.providerTxnId,
      postedAt,
      transactedAt: t.transactedAt,
      amount: t.amount,
      description: t.description,
      payee: t.payee,
      memo: t.memo,
      normalizedKey: normalizeDescription(t.payee || t.description || ''),
      pending: t.pending,
      raw: t.raw,
      updatedAt: new Date()
    };

    if (existingIds.has(t.providerTxnId)) {
      // Known transaction. Refresh the mutable provider fields only -- never
      // touch categorization, transfer links or user edits.
      await db
        .update(transactions)
        .set({
          postedAt: values.postedAt,
          amount: values.amount,
          description: values.description,
          payee: values.payee,
          memo: values.memo,
          pending: values.pending,
          raw: values.raw,
          updatedAt: values.updatedAt
        })
        .where(
          and(eq(transactions.accountId, accountId), eq(transactions.providerTxnId, t.providerTxnId))
        );
      result.updated++;
      continue;
    }

    if (!t.pending) {
      // The provider's word when it gives one (Plaid); the shape otherwise.
      // Plaid's `null` means "replaces nothing", so there is no guessing there.
      const match =
        t.replacesPendingId !== undefined
          ? openPending.find((p) => !claimedPending.has(p.id) && p.providerTxnId === t.replacesPendingId)
          : openPending.find(
              (p) =>
                !claimedPending.has(p.id) &&
                !incomingIds.includes(p.providerTxnId) &&
                toCents(p.amount) === toCents(t.amount) &&
                Math.abs(p.postedAt.getTime() - postedAt.getTime()) <= PENDING_RECONCILE_DAYS * DAY_MS
            );

      if (match) {
        claimedPending.add(match.id);
        // Promote the pending row in place: its id, category and any transfer
        // link stay intact, so nothing downstream sees a new transaction.
        await db
          .update(transactions)
          .set({
            providerTxnId: t.providerTxnId,
            postedAt: values.postedAt,
            transactedAt: values.transactedAt,
            amount: values.amount,
            description: values.description,
            payee: values.payee,
            memo: values.memo,
            normalizedKey: values.normalizedKey,
            pending: false,
            raw: values.raw,
            updatedAt: values.updatedAt
          })
          .where(eq(transactions.id, match.id));
        result.reconciled++;
        continue;
      }
    }

    // Rows older than two weeks when they first arrive are history, not news:
    // a Plaid bank sends up to two years on connect, and an inbox of two
    // thousand "to review" rows is a new person's first screen. They still
    // count everywhere; they just start reviewed.
    const isHistory = postedAt.getTime() < Date.now() - HISTORY_REVIEWED_DAYS * DAY_MS;
    await db.insert(transactions).values({ ...values, reviewedAt: isHistory ? new Date() : null }).onConflictDoNothing({
      target: [transactions.userId, transactions.provider, transactions.providerTxnId]
    });
    result.inserted++;
  }

  // Drop holds that fell off without ever posting.
  await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.pending, true),
        lt(transactions.postedAt, new Date(Date.now() - PENDING_STALE_DAYS * DAY_MS))
      )
    );

  return result;
}

/**
 * Rows the provider has withdrawn (Plaid's `removed`: a hold that dropped
 * off, or a correction). A posted row that replaced a pending one was promoted
 * in place above, so the pending id Plaid removes no longer matches anything.
 */
async function removeTransactions(provider: Provider, providerTxnIds: string[]): Promise<number> {
  if (!providerTxnIds.length) return 0;
  const gone = await db
    .delete(transactions)
    .where(and(eq(transactions.provider, provider), inArray(transactions.providerTxnId, providerTxnIds)))
    .returning({ id: transactions.id });
  return gone.length;
}

/** What a provider's sync needs from the ledger, passed in so it cannot import this module back. */
export interface LedgerWriters {
  upsertAccount: typeof upsertAccount;
  upsertTransactions: typeof upsertTransactions;
  removeTransactions: typeof removeTransactions;
}

/** Re-run categorization and matching over stored data without hitting SimpleFIN. */
export async function reprocess(): Promise<void> {
  await db
    .update(transactions)
    .set({ categorySource: 'none', categoryId: null, needsReview: false })
    .where(
      and(
        sql`${transactions.categorySource} <> 'user'`,
        gte(transactions.postedAt, new Date(Date.now() - 365 * DAY_MS))
      )
    );
  await matchTransfers(365);
  await categorizePending(5000);
}
