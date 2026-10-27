/**
 * Recurring series the person makes, beside the ones detection finds.
 *
 * Detection needs a charge to repeat on a steady cadence for a similar amount
 * (`detectRecurring()`), so it misses a new subscription seen once, a bill
 * whose amount swings, and anything paid outside a bank feed. Two ways in:
 *
 * - **Mark as recurring** on a transaction: a series for that merchant on that
 *   account, at the cadence the person picks.
 * - **Add a recurring bill** on Plan: a series with no transactions at all
 *   (`normalized_key` 'manual:…', no account), counted as paid on its due
 *   date, since nothing will ever post to say so.
 *
 * Both carry `user_set`, which detection's upsert skips: a person's decision
 * is never overwritten (the same rule as `ignored`). `refreshUserSeries()` runs
 * after every detection pass and keeps a marked series' last charge current.
 */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from './db';
import { recurringSeries, transactions } from './db/schema';
import { rollForward, stepCadence } from '../advisor/days';
import { seriesState } from '../recurringState';

/** The cadences a person can choose, in days (detection's own set). */
export const USER_CADENCES = [7, 14, 30, 90, 365] as const;

const isoDay = (d: Date) => d.toLocaleDateString('en-CA');
const atNoon = (day: string) => new Date(day + 'T12:00:00');

export const isManualKey = (key: string) => key.startsWith('manual:');

/** Everything this merchant has charged this account, oldest first. */
async function chargesFor(key: string, accountId: string) {
  return db
    .select({ amount: transactions.amount, postedAt: transactions.postedAt })
    .from(transactions)
    .where(
      and(
        eq(transactions.normalizedKey, key),
        eq(transactions.accountId, accountId),
        sql`${transactions.amount} < 0`,
        eq(transactions.isTransfer, false),
        eq(transactions.excluded, false),
        // Split parts share their parent's day; counted, they would double it.
        ne(transactions.provider, 'split')
      )
    )
    .orderBy(asc(transactions.postedAt));
}

function summarize(charges: { amount: string; postedAt: Date }[]) {
  const amounts = charges.map((c) => Math.abs(Number(c.amount)));
  const sorted = [...amounts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const typical = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const last = amounts[amounts.length - 1];
  const prior = amounts.slice(0, -1);
  const priorAvg = prior.length ? prior.reduce((s, a) => s + a, 0) / prior.length : last;
  return {
    averageAmount: typical.toFixed(2),
    lastAmount: last.toFixed(2),
    amountChanged: prior.length > 0 && Math.abs(last - priorAvg) > Math.max(1, priorAvg * 0.05),
    occurrences: charges.length,
    firstSeen: charges[0].postedAt,
    lastSeen: charges[charges.length - 1].postedAt
  };
}

/** "Mark as recurring": returns an error message, or null when done. */
export async function markRecurring(txnId: string, cadenceDays: number): Promise<string | null> {
  if (!USER_CADENCES.includes(cadenceDays as (typeof USER_CADENCES)[number])) return 'Pick how often it repeats.';
  const [t] = await db
    .select({
      key: transactions.normalizedKey,
      accountId: transactions.accountId,
      merchantName: transactions.merchantName,
      description: transactions.description,
      categoryId: transactions.categoryId,
      amount: transactions.amount,
      postedAt: transactions.postedAt,
      isTransfer: transactions.isTransfer
    })
    .from(transactions)
    .where(eq(transactions.id, txnId));
  if (!t) return 'That transaction is gone.';
  if (t.isTransfer || Number(t.amount) >= 0) return 'Only money going out can be a recurring charge.';

  const charges = await chargesFor(t.key, t.accountId);
  const s = summarize(charges.length ? charges : [{ amount: t.amount, postedAt: t.postedAt }]);
  const values = {
    merchantName: t.merchantName || t.description,
    categoryId: t.categoryId,
    cadenceDays,
    ...s,
    nextExpected: atNoon(stepCadence(isoDay(s.lastSeen), cadenceDays)),
    status: 'active',
    userSet: true,
    updatedAt: new Date()
  };
  await db
    .insert(recurringSeries)
    .values({ normalizedKey: t.key, accountId: t.accountId, ...values })
    .onConflictDoUpdate({
      target: [recurringSeries.userId, recurringSeries.normalizedKey, recurringSeries.accountId],
      // Marking it again is the person's latest word, ignored or not.
      set: values
    });
  return null;
}

export interface ManualBill {
  name: string;
  amount: number;
  cadenceDays: number;
  /** YYYY-MM-DD: the next time it is due. */
  nextDue: string;
  categoryId: string | null;
}

/** "Add a recurring bill": returns an error message, or null when done. */
export async function addManualBill(b: ManualBill): Promise<string | null> {
  const name = b.name.trim().slice(0, 80);
  if (!name) return 'Give it a name.';
  if (!(b.amount > 0) || b.amount > 1e7) return 'Enter what it costs.';
  if (!USER_CADENCES.includes(b.cadenceDays as (typeof USER_CADENCES)[number])) return 'Pick how often it repeats.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.nextDue)) return 'Pick when it is next due.';

  // The schedule is anchored one cadence before the next due date, so the
  // calendar puts the next one exactly where the person said.
  const last = stepCadence(b.nextDue, b.cadenceDays, -1);
  const amount = b.amount.toFixed(2);
  await db.insert(recurringSeries).values({
    normalizedKey: `manual:${crypto.randomUUID()}`,
    merchantName: name,
    accountId: null,
    categoryId: b.categoryId,
    cadenceDays: b.cadenceDays,
    averageAmount: amount,
    lastAmount: amount,
    occurrences: 0,
    // For a bill added by hand, first_seen is the first due date: the
    // calendar shows nothing before it.
    firstSeen: atNoon(b.nextDue),
    lastSeen: atNoon(last),
    nextExpected: atNoon(b.nextDue),
    status: 'active',
    userSet: true
  });
  return null;
}

/**
 * After detection: bring each marked series' last charge up to date (a new
 * charge at a different price, which detection would not accept as the same
 * series, still counts), and roll a hand-added bill's date past every due
 * date that has gone by.
 */
export async function refreshUserSeries(): Promise<void> {
  const rows = await db
    .select()
    .from(recurringSeries)
    .where(and(eq(recurringSeries.userSet, true), inArray(recurringSeries.status, ['active', 'ended'])));
  const today = isoDay(new Date());
  for (const r of rows) {
    if (isManualKey(r.normalizedKey) || !r.accountId) {
      if (r.status !== 'active') continue;
      const last = rollForward(isoDay(r.lastSeen), r.cadenceDays, today);
      if (last === isoDay(r.lastSeen)) continue;
      await db
        .update(recurringSeries)
        .set({
          lastSeen: atNoon(last),
          nextExpected: atNoon(stepCadence(last, r.cadenceDays)),
          updatedAt: new Date()
        })
        .where(eq(recurringSeries.id, r.id));
      continue;
    }
    const charges = await chargesFor(r.normalizedKey, r.accountId);
    if (!charges.length) continue;
    const s = summarize(charges);
    // A new charge brings an ended series back; two missed cycles end it
    // ($lib/recurringState). Ending it is not overriding the person: it is
    // what they would see on the statement, and the next charge undoes it.
    const charged = s.lastSeen.getTime() > r.lastSeen.getTime();
    const status = charged
      ? 'active'
      : seriesState(isoDay(s.lastSeen), r.cadenceDays, today).state === 'stopped'
        ? 'ended'
        : r.status;
    if (!charged && status === r.status && s.occurrences === r.occurrences) continue;
    await db
      .update(recurringSeries)
      .set({
        ...s,
        status,
        nextExpected: atNoon(stepCadence(isoDay(s.lastSeen), r.cadenceDays)),
        updatedAt: new Date()
      })
      .where(eq(recurringSeries.id, r.id));
  }
}

/**
 * "It stopped": the person says a late charge is not coming back. Ended, and
 * marked as theirs so detection does not revive it from the old charges;
 * a new charge still does (refreshUserSeries()).
 */
export async function endSeries(id: string): Promise<void> {
  await db
    .update(recurringSeries)
    .set({ status: 'ended', userSet: true, updatedAt: new Date() })
    .where(eq(recurringSeries.id, id));
}
