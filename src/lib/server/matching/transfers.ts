import { and, eq, gte, isNull, ne, or } from 'drizzle-orm';
import { db } from '../db';
import { accounts, transactions, transferGroups } from '../db/schema';
import { toCents } from '../sync/normalize';

// Transfer matching is deliberately NOT an LLM job. Pairing two legs of a
// transfer is exact arithmetic (equal magnitude, opposite sign, near in time);
// an LLM would add cost, latency and nondeterminism to something arithmetic
// already answers. The LLM's role is limited to adjudicating what lands in the
// review queue below the auto threshold.

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 5;

// Above this, pair automatically. Between REVIEW and AUTO, queue for the user.
// A wrong auto-match silently corrupts every spending report, so the bar is high.
const AUTO_THRESHOLD = 0.8;
const REVIEW_THRESHOLD = 0.55;

const PAYMENT_HINT =
  /\b(payment|autopay|auto pay|thank ?you|transfer|xfer|online banking|bill ?pay|e-?pay|epayment|pmt|withdrawal to|deposit from)\b/i;

interface Leg {
  id: string;
  accountId: string;
  accountType: string;
  orgName: string | null;
  amountCents: number;
  postedAt: Date;
  description: string;
}

interface Candidate {
  outflow: Leg;
  inflow: Leg;
  score: number;
  kind: 'cc_payment' | 'internal';
}

function daysApart(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / DAY_MS;
}

function scorePair(a: Leg, b: Leg): Candidate | null {
  // Same account can never be a transfer -- that shape is a refund or reversal.
  if (a.accountId === b.accountId) return null;
  if (a.amountCents !== -b.amountCents) return null;
  if (a.amountCents === 0) return null;

  const outflow = a.amountCents < 0 ? a : b;
  const inflow = a.amountCents < 0 ? b : a;

  const gap = daysApart(outflow.postedAt, inflow.postedAt);
  if (gap > WINDOW_DAYS) return null;

  let score = 0.5;
  if (gap < 1) score += 0.25;
  else if (gap < 2) score += 0.2;
  else if (gap < 3) score += 0.15;
  else if (gap < 4) score += 0.1;
  else score += 0.05;

  // Paying a credit card off a checking account: the classic case. The payment
  // arrives on the liability account as money *in* (balance reduced).
  const isCardPayment =
    (inflow.accountType === 'credit' || inflow.accountType === 'loan') &&
    outflow.accountType === 'depository';

  // Funding a brokerage or retirement account. Same shape as a card payment --
  // money leaves a deposit account and lands somewhere else you own -- and it
  // rarely carries a payment keyword or a shared institution, so without this
  // it scores too low to pair and every IRA contribution lands in the queue.
  const isContribution =
    inflow.accountType === 'investment' && outflow.accountType === 'depository';

  const keyword = PAYMENT_HINT.test(outflow.description) || PAYMENT_HINT.test(inflow.description);
  const sameOrg =
    !!outflow.orgName && !!inflow.orgName && outflow.orgName === inflow.orgName;

  if (isCardPayment || isContribution) score += 0.2;
  else if (outflow.accountType === 'depository' && inflow.accountType === 'depository') {
    score += 0.1;
  }
  if (keyword) score += 0.15;
  if (sameOrg) score += 0.05;

  // Guard against the dangerous false positive: a paycheck deposit and an
  // unrelated same-size expense on another account, days apart, are equal and
  // opposite but are NOT a transfer. With no card-payment shape, no keyword and
  // no shared institution, there is no evidence -- force it to the review queue
  // instead of pairing it silently.
  const hasEvidence = isCardPayment || isContribution || keyword || sameOrg;
  if (!hasEvidence) score = Math.min(score, 0.7);

  // Round amounts collide more often by chance.
  if (!hasEvidence && Math.abs(a.amountCents) % 10000 === 0) score -= 0.1;

  return {
    outflow,
    inflow,
    score: Math.max(0, Math.min(1, score)),
    // cc_payment covers every liability payment, cards and loans alike.
    kind: isCardPayment ? 'cc_payment' : 'internal'
  };
}

export interface MatchResult {
  matched: number;
  queuedForReview: number;
}

/**
 * Pair unmatched transactions into transfer groups.
 *
 * Both legs are kept: a transfer is two real ledger entries, not a duplicate.
 * Marking them `isTransfer` removes them from spending rollups while leaving
 * net worth correct.
 */
export async function matchTransfers(sinceDays = 120): Promise<MatchResult> {
  const since = new Date(Date.now() - sinceDays * DAY_MS);

  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amount: transactions.amount,
      postedAt: transactions.postedAt,
      description: transactions.description,
      accountType: accounts.type,
      orgName: accounts.orgName
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        isNull(transactions.transferGroupId),
        gte(transactions.postedAt, since),
        eq(transactions.pending, false),
        eq(accounts.isActive, true),
        // A split part is a share of a purchase, never a leg of a transfer.
        ne(transactions.provider, 'split')
      )
    );

  const legs: Leg[] = rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountType: r.accountType,
    orgName: r.orgName,
    amountCents: toCents(r.amount),
    postedAt: r.postedAt,
    description: r.description
  }));

  // Bucket by absolute cents so pairing is O(n) buckets rather than O(n^2) overall.
  const byMagnitude = new Map<number, Leg[]>();
  for (const leg of legs) {
    const key = Math.abs(leg.amountCents);
    const bucket = byMagnitude.get(key);
    if (bucket) bucket.push(leg);
    else byMagnitude.set(key, [leg]);
  }

  const candidates: Candidate[] = [];
  for (const bucket of byMagnitude.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const c = scorePair(bucket[i], bucket[j]);
        if (c && c.score >= REVIEW_THRESHOLD) candidates.push(c);
      }
    }
  }

  // Greedy: best scores claim their legs first, and each leg is used once.
  candidates.sort((a, b) => b.score - a.score);

  const claimed = new Set<string>();
  let matched = 0;
  let queuedForReview = 0;

  for (const c of candidates) {
    if (claimed.has(c.outflow.id) || claimed.has(c.inflow.id)) continue;

    if (c.score >= AUTO_THRESHOLD) {
      claimed.add(c.outflow.id);
      claimed.add(c.inflow.id);
      await linkTransfer(c.outflow.id, c.inflow.id, c.kind, c.score, 'auto');
      matched++;
    } else {
      // Don't claim the legs -- a better pairing may still exist for either.
      await db
        .update(transactions)
        .set({ needsReview: true, updatedAt: new Date() })
        .where(or(eq(transactions.id, c.outflow.id), eq(transactions.id, c.inflow.id)));
      queuedForReview++;
    }
  }

  return { matched, queuedForReview };
}

export async function linkTransfer(
  outflowId: string,
  inflowId: string,
  kind: 'cc_payment' | 'internal' | 'manual',
  confidence: number,
  matchedBy: 'auto' | 'user'
): Promise<string> {
  const [leg] = await db
    .select({ amount: transactions.amount })
    .from(transactions)
    .where(eq(transactions.id, inflowId));

  const [group] = await db
    .insert(transferGroups)
    .values({
      kind,
      amount: leg?.amount ?? '0',
      confidence,
      matchedBy
    })
    .returning({ id: transferGroups.id });

  await db
    .update(transactions)
    .set({
      transferGroupId: group.id,
      isTransfer: true,
      needsReview: false,
      categorySource: matchedBy === 'user' ? 'user' : 'rule',
      updatedAt: new Date()
    })
    .where(or(eq(transactions.id, outflowId), eq(transactions.id, inflowId)));

  return group.id;
}

/** User override: break a pairing the matcher got wrong. */
export async function unlinkTransfer(groupId: string): Promise<void> {
  await db
    .update(transactions)
    .set({
      transferGroupId: null,
      isTransfer: false,
      needsReview: true,
      updatedAt: new Date()
    })
    .where(eq(transactions.transferGroupId, groupId));

  await db.delete(transferGroups).where(eq(transferGroups.id, groupId));
}
