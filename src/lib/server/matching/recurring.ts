import { and, eq, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { accounts, merchants, recurringSeries, transactions } from '../db/schema';
import { refreshUserSeries } from '../recurringUser';
import { seriesState } from '../../recurringState';

const isoDay = (d: Date) => d.toLocaleDateString('en-CA');

// Subscription detection is arithmetic, not judgement: a charge that repeats on
// a steady cadence for roughly the same amount is recurring. No LLM involved --
// the model could not do this better and would cost money to ask.

const DAY_MS = 24 * 60 * 60 * 1000;

// Cadences worth recognising, with how far an interval may drift and still
// count. Monthly gets the widest window because billing dates slide across
// weekends and short months.
const CADENCES: Array<{ days: number; tolerance: number; label: string }> = [
  { days: 7, tolerance: 2, label: 'weekly' },
  { days: 14, tolerance: 3, label: 'every 2 weeks' },
  { days: 30, tolerance: 5, label: 'monthly' },
  { days: 90, tolerance: 12, label: 'quarterly' },
  { days: 365, tolerance: 30, label: 'yearly' }
];

const MIN_OCCURRENCES = 3;
const LOOKBACK_DAYS = 400;

// How much the amounts in a series may vary and still be "the same charge".
// Utilities drift; a subscription barely moves. 20% catches both without
// swallowing ordinary variable spending at the same merchant.
const AMOUNT_TOLERANCE = 0.2;

export function cadenceLabel(days: number): string {
  return CADENCES.find((c) => c.days === days)?.label ?? `every ${days} days`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface Candidate {
  normalizedKey: string;
  merchantName: string;
  accountId: string;
  categoryId: string | null;
  cadenceDays: number;
  averageAmount: number;
  lastAmount: number;
  amountChanged: boolean;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
  nextExpected: Date;
  ended: boolean;
}

export interface RecurringResult {
  detected: number;
  ended: number;
  amountChanges: number;
  /** Recognised by name rather than by cadence -- see suspectSubscriptions(). */
  suspected: number;
}

export async function detectRecurring(): Promise<RecurringResult> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS);

  const rows = await db
    .select({
      normalizedKey: transactions.normalizedKey,
      merchantName: transactions.merchantName,
      description: transactions.description,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
      amount: transactions.amount,
      postedAt: transactions.postedAt
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        gte(transactions.postedAt, since),
        eq(transactions.isTransfer, false),
        eq(transactions.excluded, false),
        // Split parts share their parent's merchant and day; counted as
        // charges they would invent a schedule.
        ne(transactions.provider, 'split'),
        eq(transactions.pending, false),
        eq(accounts.isActive, true),
        // Brokerage feeds repeat internal bookkeeping on a cadence that looks
        // exactly like a subscription and means nothing.
        ne(accounts.type, 'investment'),
        sql`${transactions.amount} < 0`
      )
    )
    .orderBy(transactions.postedAt);

  // One series per merchant per account: the same subscription billed to two
  // different cards is two series, which is what the user sees on the statement.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.accountId}::${r.normalizedKey}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  const candidates: Candidate[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const times = group.map((g) => g.postedAt.getTime());
    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) intervals.push((times[i] - times[i - 1]) / DAY_MS);

    const typical = median(intervals);
    const cadence = CADENCES.find((c) => Math.abs(typical - c.days) <= c.tolerance);
    if (!cadence) continue;

    // Every interval has to fit the cadence, not just the median. Otherwise a
    // merchant visited at random that happens to average 30 days qualifies.
    const consistent = intervals.every((i) => Math.abs(i - cadence.days) <= cadence.tolerance * 2);
    if (!consistent) continue;

    const amounts = group.map((g) => Math.abs(Number(g.amount)));
    const typicalAmount = median(amounts);
    if (typicalAmount <= 0) continue;

    const amountsFit = amounts.every(
      (a) => Math.abs(a - typicalAmount) <= Math.max(1, typicalAmount * AMOUNT_TOLERANCE)
    );
    if (!amountsFit) continue;

    // Three occurrences is the general bar, because two charges a month apart
    // for similar amounts happen by chance. Two is enough only when the amounts
    // are identical to the cent and the gap lands on a cadence -- that is a
    // subscription, and with a 90-day sync window a monthly one cannot show up
    // more than three times anyway. The alternative is failing to notice AT&T.
    const identicalAmounts = Math.max(...amounts) - Math.min(...amounts) < 0.005;
    if (group.length < MIN_OCCURRENCES && !identicalAmounts) continue;

    const last = group[group.length - 1];
    const lastAmount = Math.abs(Number(last.amount));
    const priorAmounts = amounts.slice(0, -1);
    const priorTypical = median(priorAmounts);

    const lastSeen = last.postedAt;
    const nextExpected = new Date(lastSeen.getTime() + cadence.days * DAY_MS);

    candidates.push({
      normalizedKey: last.normalizedKey,
      merchantName: last.merchantName || last.description,
      accountId: last.accountId,
      categoryId: last.categoryId,
      cadenceDays: cadence.days,
      averageAmount: typicalAmount,
      lastAmount,
      // Worth surfacing: a subscription that quietly went up in price.
      amountChanged:
        priorAmounts.length > 0 &&
        Math.abs(lastAmount - priorTypical) > Math.max(1, priorTypical * 0.05),
      occurrences: group.length,
      firstSeen: group[0].postedAt,
      lastSeen,
      nextExpected,
      // Two cadences with nothing new means it stopped, so it should leave the
      // monthly total rather than linger forever ($lib/recurringState).
      ended: seriesState(isoDay(lastSeen), cadence.days, isoDay(new Date())).state === 'stopped'
    });
  }

  const result: RecurringResult = { detected: 0, ended: 0, amountChanges: 0, suspected: 0 };

  for (const c of candidates) {
    await db
      .insert(recurringSeries)
      .values({
        normalizedKey: c.normalizedKey,
        merchantName: c.merchantName,
        accountId: c.accountId,
        categoryId: c.categoryId,
        cadenceDays: c.cadenceDays,
        averageAmount: c.averageAmount.toFixed(2),
        lastAmount: c.lastAmount.toFixed(2),
        amountChanged: c.amountChanged,
        occurrences: c.occurrences,
        firstSeen: c.firstSeen,
        lastSeen: c.lastSeen,
        nextExpected: c.nextExpected,
        status: c.ended ? 'ended' : 'active'
      })
      .onConflictDoUpdate({
        target: [recurringSeries.userId, recurringSeries.normalizedKey, recurringSeries.accountId],
        set: {
          merchantName: c.merchantName,
          categoryId: c.categoryId,
          cadenceDays: c.cadenceDays,
          averageAmount: c.averageAmount.toFixed(2),
          lastAmount: c.lastAmount.toFixed(2),
          amountChanged: c.amountChanged,
          occurrences: c.occurrences,
          lastSeen: c.lastSeen,
          nextExpected: c.nextExpected,
          status: c.ended ? 'ended' : 'active',
          updatedAt: new Date()
        },
        // "Ignored" is a decision the user made, and so is a series they
        // marked or added themselves; a resync must not undo either.
        setWhere: and(ne(recurringSeries.status, 'ignored'), eq(recurringSeries.userSet, false))
      });

    result.detected++;
    if (c.ended) result.ended++;
    if (c.amountChanged) result.amountChanges++;
  }

  result.suspected = await suspectSubscriptions(new Set(candidates.map((c) => c.normalizedKey)));
  result.ended += await endStoppedSuspects();
  await refreshUserSeries();
  return result;
}

/**
 * A subscription seen once is assumed monthly. If the second charge never
 * comes it was not a subscription after all, or it was cancelled -- either
 * way it ends rather than sitting in the monthly total forever.
 */
async function endStoppedSuspects(): Promise<number> {
  const rows = await db
    .select({ id: recurringSeries.id, lastSeen: recurringSeries.lastSeen, cadenceDays: recurringSeries.cadenceDays })
    .from(recurringSeries)
    .where(and(eq(recurringSeries.status, 'suspected'), eq(recurringSeries.userSet, false)));
  const today = isoDay(new Date());
  let n = 0;
  for (const r of rows) {
    if (seriesState(isoDay(r.lastSeen), r.cadenceDays, today).state !== 'stopped') continue;
    await db.update(recurringSeries).set({ status: 'ended', updatedAt: new Date() }).where(eq(recurringSeries.id, r.id));
    n++;
  }
  return n;
}

/**
 * Cadence detection needs the charge to have happened at least twice. A card
 * connected last month cannot show a monthly subscription more than once, so
 * "ANTHROPIC* CLAUDE SUB" and "GOOGLE *SPOTIFY MUSIC" are invisible to
 * arithmetic no matter how obvious they are to a reader.
 *
 * The model already labels each new merchant as a subscription or not while
 * categorizing, at no extra cost. This promotes those single sightings to a
 * `suspected` series so they are surfaced rather than silently missed -- kept
 * separate from confirmed ones, because a name is weaker evidence than a
 * demonstrated cadence, and the monthly total is a guess until the second
 * charge lands.
 */
async function suspectSubscriptions(alreadyDetected: Set<string>): Promise<number> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS);

  const rows = await db
    .select({
      normalizedKey: transactions.normalizedKey,
      merchantName: sql<string>`max(coalesce(${transactions.merchantName}, ${transactions.description}))`,
      accountId: transactions.accountId,
      categoryId: sql<string | null>`max(${transactions.categoryId}::text)`,
      occurrences: sql<number>`count(*)`,
      total: sql<string>`sum(-${transactions.amount})`,
      lastAmount: sql<string>`max(-${transactions.amount})`,
      firstSeen: sql<Date>`min(${transactions.postedAt})`,
      lastSeen: sql<Date>`max(${transactions.postedAt})`
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .innerJoin(merchants, eq(merchants.normalizedKey, transactions.normalizedKey))
    .where(
      and(
        eq(merchants.isSubscription, true),
        gte(transactions.postedAt, since),
        eq(transactions.isTransfer, false),
        eq(transactions.excluded, false),
        // Split parts share their parent's merchant and day; counted as
        // charges they would invent a schedule.
        ne(transactions.provider, 'split'),
        eq(transactions.pending, false),
        eq(accounts.isActive, true),
        sql`${transactions.amount} < 0`
      )
    )
    .groupBy(transactions.normalizedKey, transactions.accountId);

  let count = 0;

  for (const r of rows) {
    // A confirmed cadence always wins; this is only for what arithmetic missed.
    if (alreadyDetected.has(r.normalizedKey)) continue;

    const lastSeen = new Date(r.lastSeen);
    const average = Number(r.total) / Number(r.occurrences);

    await db
      .insert(recurringSeries)
      .values({
        normalizedKey: r.normalizedKey,
        merchantName: r.merchantName,
        accountId: r.accountId,
        categoryId: r.categoryId,
        // Monthly is the assumption until a second charge proves otherwise; it
        // is by far the most common subscription cadence.
        cadenceDays: 30,
        averageAmount: average.toFixed(2),
        lastAmount: Number(r.lastAmount).toFixed(2),
        amountChanged: false,
        occurrences: Number(r.occurrences),
        firstSeen: new Date(r.firstSeen),
        lastSeen,
        nextExpected: new Date(lastSeen.getTime() + 30 * DAY_MS),
        status: 'suspected'
      })
      .onConflictDoUpdate({
        target: [recurringSeries.userId, recurringSeries.normalizedKey, recurringSeries.accountId],
        set: {
          merchantName: r.merchantName,
          averageAmount: average.toFixed(2),
          lastAmount: Number(r.lastAmount).toFixed(2),
          occurrences: Number(r.occurrences),
          lastSeen,
          status: 'suspected',
          updatedAt: new Date()
        },
        // Never demote a confirmed series, and never undo a user's decision.
        // An ended one that charges again comes back (endStoppedSuspects()
        // ends it again straight after if that charge is old).
        setWhere: and(
          inArray(recurringSeries.status, ['suspected', 'ended']),
          eq(recurringSeries.userSet, false),
          or(eq(recurringSeries.status, 'suspected'), lt(recurringSeries.lastSeen, lastSeen))
        )
      });

    count++;
  }

  return count;
}

/** Normalises any cadence to what it costs per month, for a comparable total. */
export function monthlyEquivalent(amount: number, cadenceDays: number): number {
  return (amount * 30.44) / cadenceDays;
}
