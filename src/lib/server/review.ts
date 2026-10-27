/**
 * Reviewing (v2): every synced row lands unreviewed and carries the accent
 * dot until somebody marks it. Marking also clears the old low-confidence
 * flag -- a person looked at it, which is what that flag was asking for.
 */
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from './db';
import { accounts, categories, syncRuns, transactions, userPreferences } from './db/schema';
import { cleanMerchant } from '../merchantName';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unreviewed, not excluded (a split parent is excluded; its parts are not). */
export const toReview = () =>
  and(isNull(transactions.reviewedAt), eq(transactions.excluded, false));

export async function markReviewed(ids: string[]): Promise<number> {
  const clean = ids.filter((id) => UUID.test(id));
  if (!clean.length) return 0;
  const done = await db
    .update(transactions)
    .set({ reviewedAt: new Date(), needsReview: false, updatedAt: new Date() })
    .where(and(inArray(transactions.id, clean), isNull(transactions.reviewedAt)))
    .returning({ id: transactions.id });
  return done.length;
}

export async function markUnreviewed(id: string): Promise<void> {
  if (!UUID.test(id)) return;
  await db.update(transactions).set({ reviewedAt: null, updatedAt: new Date() }).where(eq(transactions.id, id));
}

/** The newest unreviewed rows, shaped for TransactionRow, and how many in all. */
export async function reviewInbox(limit = 6) {
  const rows = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      merchantName: transactions.merchantName,
      description: transactions.description,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      isTransfer: transactions.isTransfer,
      pending: transactions.pending,
      postedAt: transactions.postedAt
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(toReview())
    .orderBy(desc(transactions.postedAt))
    .limit(limit);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(toReview());
  return {
    total: n,
    rows: rows.map((r) => ({
      id: r.id,
      merchant: cleanMerchant(r.merchantName || r.description),
      amount: Number(r.amount),
      categoryName: r.categoryName,
      categoryIcon: r.categoryIcon,
      isTransfer: r.isTransfer,
      pending: r.pending,
      unreviewed: true,
      postedAt: r.postedAt
    }))
  };
}

/**
 * Everything waiting for review, or (with `before`) only what posted before
 * that day -- "Review just the last 2 weeks" marks the older rows done and
 * leaves the recent ones to look at.
 */
export async function markAllReviewed(before?: Date): Promise<number> {
  const done = await db
    .update(transactions)
    .set({ reviewedAt: new Date(), needsReview: false, updatedAt: new Date() })
    .where(and(toReview(), before ? lt(transactions.postedAt, before) : undefined))
    .returning({ id: transactions.id });
  return done.length;
}

// ---- the first sync ------------------------------------------------
// A new connection's first sync lands months of history unreviewed. Claiming
// a token stamps `first_sync_at`; once a sync has finished after it, Activity
// shows one card offering to review just the last two weeks. Either answer
// clears the stamp, so the card is seen once per new connection.

/** Called when a setup token is claimed. Upsert: the row may not exist yet. */
export async function startFirstSyncReview(): Promise<void> {
  const now = new Date();
  await db
    .insert(userPreferences)
    .values({ firstSyncAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [userPreferences.userId], set: { firstSyncAt: now, updatedAt: now } });
}

export async function endFirstSyncReview(): Promise<void> {
  await db.update(userPreferences).set({ firstSyncAt: null, updatedAt: new Date() });
}

/** The card's count, or null when there is no card to show. */
export async function firstSyncReview(): Promise<{ count: number } | null> {
  const [pref] = await db.select({ at: userPreferences.firstSyncAt }).from(userPreferences).limit(1);
  if (!pref?.at) return null;
  const [run] = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(and(gte(syncRuns.startedAt, pref.at), sql`${syncRuns.finishedAt} is not null`, sql`${syncRuns.status} <> 'failed'`))
    .limit(1);
  if (!run) return null;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(transactions).where(toReview());
  return n > 0 ? { count: n } : null;
}
