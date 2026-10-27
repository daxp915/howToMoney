import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { accounts, categories, merchants, rules, transactions } from '../db/schema';
import { titleCase } from '../sync/normalize';
import { getProvider, type ClassifyInput, type ClassifyUsage } from './provider';

// Four layers, cheapest first. Only layer 3 costs money, and it only ever sees
// merchants the system has never encountered before -- which is why the monthly
// bill flattens to near zero after the first sync.
//
//   1. rules          user-defined, exact, free
//   2. merchant memory learned key -> category lookup, free
//   3. LLM            unseen merchants only, batched, deduplicated by key
//   4. review queue   anything still uncertain goes to a human

// Calibrated against a real 149-transaction sample. The model's 0.70 band was
// consistently correct (Walmart -> Groceries, Dept of Education -> Education,
// Venmo -> Transfer); it scores conservatively because the prompt tells it not
// to inflate. Everything at or below 0.60 was genuinely ambiguous ("DEPOSIT
// DEP", "DEBIT") or brokerage bookkeeping. 0.75 sent 60% of the ledger to the
// review queue for nothing.
const REVIEW_CONFIDENCE = 0.68;

export interface CategorizeResult {
  total: number;
  byRule: number;
  byMemory: number;
  byAi: number;
  queuedForReview: number;
  usage: ClassifyUsage;
}

export async function categorizePending(limit = 2000): Promise<CategorizeResult> {
  const out: CategorizeResult = {
    total: 0,
    byRule: 0,
    byMemory: 0,
    byAi: 0,
    queuedForReview: 0,
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 }
  };

  const pending = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountType: accounts.type,
      amount: transactions.amount,
      description: transactions.description,
      normalizedKey: transactions.normalizedKey
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.categorySource, 'none'), eq(transactions.isTransfer, false)))
    .orderBy(asc(transactions.postedAt))
    .limit(limit);

  out.total = pending.length;
  if (!pending.length) return out;

  const categoryRows = await db.select().from(categories);
  const categoryIdByName = new Map(categoryRows.map((c) => [c.name, c.id]));
  const categoryNames = categoryRows.map((c) => c.name);

  const unresolved = new Set(pending.map((t) => t.id));

  // ---- Layer 1: rules -------------------------------------------------------
  const ruleRows = await db
    .select()
    .from(rules)
    .where(eq(rules.enabled, true))
    .orderBy(asc(rules.priority));

  for (const txn of pending) {
    const rule = ruleRows.find((r) => ruleMatches(r, txn));
    if (!rule) continue;

    await db
      .update(transactions)
      .set({
        categoryId: rule.setCategoryId ?? undefined,
        merchantName: rule.setMerchantName ?? undefined,
        isTransfer: rule.setIsTransfer ?? undefined,
        excluded: rule.setExcluded ?? undefined,
        categorySource: 'rule',
        categoryConfidence: 1,
        needsReview: false,
        updatedAt: new Date()
      })
      .where(eq(transactions.id, txn.id));

    unresolved.delete(txn.id);
    out.byRule++;
  }

  // ---- Layer 2: learned merchant memory -------------------------------------
  const remaining = pending.filter((t) => unresolved.has(t.id));
  const keys = [...new Set(remaining.map((t) => t.normalizedKey))];

  const known = keys.length
    ? await db.select().from(merchants).where(inArray(merchants.normalizedKey, keys))
    : [];
  const memory = new Map(known.map((m) => [m.normalizedKey, m]));

  for (const txn of remaining) {
    const hit = memory.get(txn.normalizedKey);
    if (!hit || !hit.categoryId) continue;

    await db
      .update(transactions)
      .set({
        categoryId: hit.categoryId,
        merchantId: hit.id,
        merchantName: hit.displayName,
        categorySource: 'memory',
        categoryConfidence: hit.pinnedByUser ? 1 : (hit.confidence ?? 0.9),
        needsReview: false,
        updatedAt: new Date()
      })
      .where(eq(transactions.id, txn.id));

    await db
      .update(merchants)
      .set({ seenCount: sql`${merchants.seenCount} + 1`, updatedAt: new Date() })
      .where(eq(merchants.id, hit.id));

    unresolved.delete(txn.id);
    out.byMemory++;
  }

  // ---- Layer 3: LLM, unseen merchants only ----------------------------------
  const stillUnknown = remaining.filter((t) => unresolved.has(t.id));
  if (!stillUnknown.length) return out;

  // Classify each distinct merchant key ONCE, not once per transaction. Twelve
  // Starbucks visits are one row of work, not twelve.
  const representatives = new Map<string, (typeof stillUnknown)[number]>();
  for (const txn of stillUnknown) {
    if (!representatives.has(txn.normalizedKey)) representatives.set(txn.normalizedKey, txn);
  }

  const inputs: ClassifyInput[] = [];
  const keyByIndex = new Map<number, string>();
  let idx = 0;
  for (const [key, txn] of representatives) {
    keyByIndex.set(idx, key);
    inputs.push({
      index: idx,
      description: txn.description,
      amount: txn.amount,
      accountType: txn.accountType
    });
    idx++;
  }

  const provider = await getProvider();

  // With no AI backend configured, stop here and leave these rows at
  // categorySource 'none'. Recording a non-answer as an 'ai' verdict would
  // permanently exclude them from layer 3 -- a later run with a real provider
  // selects on categorySource = 'none' and would skip every row a dry run had
  // already touched.
  if (provider.name === 'none') {
    out.queuedForReview += stillUnknown.length;
    return out;
  }

  const { results, usage } = await provider.classify(inputs, categoryNames);
  out.usage = usage;

  for (const r of results) {
    const key = keyByIndex.get(r.index);
    if (!key) continue;

    const rep = representatives.get(key)!;
    const categoryId = r.category ? categoryIdByName.get(r.category) : undefined;
    const confident = !!categoryId && r.confidence >= REVIEW_CONFIDENCE;
    const displayName = r.merchant || titleCase(key);

    // Remember the verdict even when it is weak -- the merchant row is what the
    // user edits in the review queue, and one correction fixes it permanently.
    const [merchant] = await db
      .insert(merchants)
      .values({
        normalizedKey: key,
        displayName,
        categoryId: categoryId ?? null,
        source: 'ai',
        confidence: r.confidence,
        isSubscription: r.isSubscription,
        seenCount: 1
      })
      .onConflictDoUpdate({
        target: [merchants.userId, merchants.normalizedKey],
        set: { displayName, isSubscription: r.isSubscription, updatedAt: new Date() },
        // Never let a fresh AI guess overwrite a mapping the user pinned.
        setWhere: eq(merchants.pinnedByUser, false)
      })
      .returning();

    const matching = stillUnknown.filter((t) => t.normalizedKey === key);
    if (!matching.length) continue;

    // Brokerage rows never reach a spending or income figure, so a weak verdict
    // on one costs nothing and asking about it wastes the user's attention.
    // "REINVESTMENT FIDELITY 500 INDEX" is not a decision anyone needs to make.
    const groups: Array<{ ids: string[]; review: boolean }> = [
      { ids: matching.filter((t) => t.accountType !== 'investment').map((t) => t.id), review: !confident },
      { ids: matching.filter((t) => t.accountType === 'investment').map((t) => t.id), review: false }
    ];

    for (const g of groups) {
      if (!g.ids.length) continue;
      await db
        .update(transactions)
        .set({
          categoryId: categoryId ?? null,
          merchantId: merchant?.id ?? null,
          merchantName: displayName,
          categorySource: 'ai',
          categoryConfidence: r.confidence,
          needsReview: g.review,
          updatedAt: new Date()
        })
        .where(inArray(transactions.id, g.ids));
    }

    if (confident) out.byAi += matching.length;
    else out.queuedForReview += groups[0].ids.length;
  }

  return out;
}

type RuleRow = typeof rules.$inferSelect;
type TxnRow = {
  accountId: string;
  amount: string;
  description: string;
  normalizedKey: string;
};

function ruleMatches(rule: RuleRow, txn: TxnRow): boolean {
  if (rule.accountId && rule.accountId !== txn.accountId) return false;

  const amount = Number(txn.amount);
  if (rule.amountMin !== null && amount < Number(rule.amountMin)) return false;
  if (rule.amountMax !== null && amount > Number(rule.amountMax)) return false;

  const haystack = (
    rule.matchField === 'normalized' ? txn.normalizedKey : txn.description
  ).toLowerCase();
  const needle = rule.matchValue.toLowerCase();

  switch (rule.matchType) {
    case 'equals':
      return haystack === needle;
    case 'regex':
      try {
        return new RegExp(rule.matchValue, 'i').test(haystack);
      } catch {
        // A malformed user regex must not take down the whole sync.
        console.warn(`[rules] invalid regex in rule ${rule.id}: ${rule.matchValue}`);
        return false;
      }
    case 'contains':
    default:
      return haystack.includes(needle);
  }
}

/**
 * Fills in `merchants.isSubscription` for merchants that never reached the
 * model.
 *
 * Layers 1 and 2 are the whole point of the pipeline -- a merchant already in
 * the cache is answered for free and never classified again. That also means it
 * never gets asked anything *new*. When a question is added to the classifier,
 * every merchant learned before that day is missing the answer, and a boolean
 * defaulting to false hides it: "not a subscription" and "never asked" look
 * identical.
 *
 * Hence the nullable column and this pass. It runs once per new question, costs
 * one batched call per 40 merchants, and then never has anything to do again.
 */
export async function backfillSubscriptionFlags(limit = 500): Promise<{
  asked: number;
  subscriptions: number;
  usage: ClassifyUsage;
}> {
  const out = {
    asked: 0,
    subscriptions: 0,
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 }
  };

  const provider = await getProvider();
  if (provider.name === 'none') return out;

  const unasked = await db
    .select({ normalizedKey: merchants.normalizedKey })
    .from(merchants)
    .where(isNull(merchants.isSubscription))
    .limit(limit);

  if (!unasked.length) return out;

  // One representative transaction per merchant, fetched as its own query and
  // joined in memory.
  //
  // This was a correlated subquery until it silently broke: drizzle emitted the
  // outer column unqualified inside the subquery, so `t.normalized_key =
  // normalized_key` compared the inner table against itself, matched every row,
  // and handed the same arbitrary transaction to all 60 merchants. Every answer
  // came back wrong and nothing errored. Two plain queries cannot fail that way.
  const keys = unasked.map((m) => m.normalizedKey);
  const samples = await db
    .selectDistinctOn([transactions.normalizedKey], {
      normalizedKey: transactions.normalizedKey,
      description: transactions.description,
      amount: transactions.amount
    })
    .from(transactions)
    .where(inArray(transactions.normalizedKey, keys))
    .orderBy(transactions.normalizedKey, desc(transactions.postedAt));

  const sampleByKey = new Map(samples.map((s) => [s.normalizedKey, s]));

  const items = unasked
    .map((m) => sampleByKey.get(m.normalizedKey))
    .filter((s): s is NonNullable<typeof s> => !!s && !!s.description);

  if (!items.length) return out;

  const categoryNames = (await db.select({ name: categories.name }).from(categories)).map(
    (c) => c.name
  );

  const { results, usage } = await provider.classify(
    items.map((m, i) => ({
      index: i,
      description: m.description,
      amount: m.amount ?? '0',
      accountType: 'unknown'
    })),
    categoryNames
  );
  out.usage = usage;

  for (const r of results) {
    const merchant = items[r.index];
    if (!merchant) continue;
    await db
      .update(merchants)
      .set({ isSubscription: r.isSubscription, updatedAt: new Date() })
      .where(eq(merchants.normalizedKey, merchant.normalizedKey));
    out.asked++;
    if (r.isSubscription) out.subscriptions++;
  }

  return out;
}
