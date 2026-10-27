import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import { merchants, transactions } from '../db/schema';

// A correction is the most valuable signal in the system: it pins the merchant
// mapping so the LLM is never asked about that merchant again, and it back-fills
// every other transaction from the same merchant that the user has not already
// edited by hand.

export interface FeedbackResult {
  updated: number;
  backfilled: number;
}

export async function applyUserCategory(
  txnId: string,
  categoryId: string,
  opts: { propagate?: boolean } = {}
): Promise<FeedbackResult> {
  const propagate = opts.propagate ?? true;

  const [txn] = await db
    .select({
      id: transactions.id,
      normalizedKey: transactions.normalizedKey,
      merchantName: transactions.merchantName,
      description: transactions.description
    })
    .from(transactions)
    .where(eq(transactions.id, txnId));

  if (!txn) return { updated: 0, backfilled: 0 };

  const displayName = txn.merchantName || txn.description;

  const [merchant] = await db
    .insert(merchants)
    .values({
      normalizedKey: txn.normalizedKey,
      displayName,
      categoryId,
      source: 'user',
      confidence: 1,
      pinnedByUser: true,
      seenCount: 1
    })
    .onConflictDoUpdate({
      target: [merchants.userId, merchants.normalizedKey],
      set: {
        categoryId,
        source: 'user',
        confidence: 1,
        pinnedByUser: true,
        updatedAt: new Date()
      }
    })
    .returning();

  await db
    .update(transactions)
    .set({
      categoryId,
      merchantId: merchant?.id ?? null,
      categorySource: 'user',
      categoryConfidence: 1,
      needsReview: false,
      updatedAt: new Date()
    })
    .where(eq(transactions.id, txnId));

  let backfilled = 0;
  if (propagate) {
    // Only rows the user has not personally set. A manual override on one
    // Amazon charge must not be stomped by a correction on another.
    const res = await db
      .update(transactions)
      .set({
        categoryId,
        merchantId: merchant?.id ?? null,
        categorySource: 'memory',
        categoryConfidence: 1,
        needsReview: false,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(transactions.normalizedKey, txn.normalizedKey),
          ne(transactions.categorySource, 'user'),
          eq(transactions.isTransfer, false),
          ne(transactions.id, txnId)
        )
      )
      .returning({ id: transactions.id });
    backfilled = res.length;
  }

  await db
    .update(merchants)
    .set({ seenCount: sql`${merchants.seenCount} + 1` })
    .where(eq(merchants.normalizedKey, txn.normalizedKey));

  return { updated: 1, backfilled };
}

export async function setExcluded(txnId: string, excluded: boolean): Promise<void> {
  await db
    .update(transactions)
    .set({ excluded, needsReview: false, updatedAt: new Date() })
    .where(eq(transactions.id, txnId));
}

export async function dismissReview(txnId: string): Promise<void> {
  await db
    .update(transactions)
    .set({ needsReview: false, updatedAt: new Date() })
    .where(eq(transactions.id, txnId));
}
