/**
 * Home's optional cards (see `HOME_CARDS` in $lib/preferences): each a glance
 * at something another page owns, computed only when the card is switched on.
 *
 * None of them repeats its page. Wealth draws the net-worth trend and every
 * account; Home says the figure and how it moved. Plan's recurring tab is the
 * calendar; Home says when pay lands and what has to be paid first.
 */
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from './db';
import { accounts, categories, transactions } from './db/schema';
import { cashFlowScope, spendingSide } from './cashflow';
import { listGoals } from './goals';
import { wealthOverview } from './wealth';
import { bills } from './advisor/facts';
import { monthlyEquivalent } from './matching/recurring';
import { monthEvents, type PlanEvent } from './plan';
import { addDays } from '../advisor/days';
import { cleanMerchant } from '../merchantName';
import { drillHref, monthBounds } from '../drill';

const iso = (d: Date) => d.toLocaleDateString('en-CA');

/** How far apart two legs of one split paycheck can land. */
const SPLIT_DAYS = 3;

export interface Payday {
  date: string;
  /** Whole days from today. */
  days: number;
  amount: number;
  /** Bills not yet paid, due from today up to the day before pay. */
  due: number;
  dueCount: number;
}

/**
 * The next paycheck still to come, and the bills that land before it. Reads
 * this month's events (which Home already has) and only looks at next month's
 * when pay is not due again this month.
 */
export async function payday(events: PlanEvent[], now = new Date()): Promise<Payday | null> {
  const today = iso(now);
  const ahead = (list: PlanEvent[]) => list.filter((e) => !e.paid && e.date >= today);
  let list = ahead(events);
  if (!list.some((e) => e.kind === 'pay')) {
    const next = await monthEvents(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    list = [...list, ...ahead(next)];
  }
  const pays = list.filter((e) => e.kind === 'pay' && e.date > today).sort((a, b) => a.date.localeCompare(b.date));
  if (!pays.length) return null;
  const date = pays[0].date;
  // A paycheck split across two accounts is two deposit series, and the legs
  // need not land together: real data had the savings leg a day or three
  // ahead of the checking one (Sep 11 / Sep 14). Same employer within
  // SPLIT_DAYS of the first is one payday; the tile showed $900 of $2,244.
  const until = addDays(date, SPLIT_DAYS);
  const amount = pays
    .filter((e) => e.name === pays[0].name && e.date <= until)
    .reduce((s, e) => s + e.amount, 0);
  const before = list.filter((e) => e.kind !== 'pay' && e.date < date);
  return {
    date,
    days: Math.round((new Date(date + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 864e5),
    amount,
    due: before.reduce((s, e) => s - e.amount, 0),
    dueCount: before.length
  };
}

/** Net worth today and its change over the last month (Wealth's 1M). */
export async function worth(): Promise<{ value: number; change: number; since: string }> {
  const w = await wealthOverview('1m', null);
  return { value: w.worth, change: w.series.change, since: w.series.from };
}

/** Repeating charges as a monthly cost, and how many of them changed price. */
export async function repeating(): Promise<{ monthly: number; count: number; changed: number; missed: number } | null> {
  // bills() has already dropped series that stopped ($lib/recurringState).
  const live = (await bills()).filter((b) => !b.suspected && b.cadenceDays > 0);
  if (!live.length) return null;
  return {
    monthly: live.reduce((s, b) => s + monthlyEquivalent(b.usual, b.cadenceDays), 0),
    count: live.length,
    changed: live.filter((b) => b.changed).length,
    missed: live.filter((b) => b.missed).length
  };
}

export interface GoalGlance {
  id: string;
  name: string;
  progress: number;
  current: number;
  target: number;
  onTrack: boolean | null;
}

/** Active goals, in Plan's order, three of them. */
export async function goalGlance(): Promise<{ rows: GoalGlance[]; total: number }> {
  const active = (await listGoals()).filter((g) => g.status === 'active');
  return {
    total: active.length,
    rows: active.slice(0, 3).map((g) => ({
      id: g.id,
      name: g.name,
      progress: g.progress,
      // Debt is stored negative; a payoff reads as what is still owed.
      current: g.direction === 'payoff' ? Math.abs(g.current) : g.current,
      target: g.direction === 'payoff' ? Math.abs(g.starting) : g.target,
      onTrack: g.onTrack
    }))
  };
}

export interface Place {
  key: string;
  name: string;
  spent: number;
  count: number;
  href: string;
}

/**
 * The merchants this month's spending went to most, through the same
 * cash-flow scope as every other spending figure, so each one's link lists
 * exactly the rows it sums.
 */
export async function topPlaces(now = new Date(), limit = 4): Promise<Place[]> {
  const { from, to } = monthBounds(now);
  const rows = await db
    .select({
      key: transactions.normalizedKey,
      name: sql<string>`max(coalesce(${transactions.merchantName}, ${transactions.description}))`,
      spent: sql<string>`sum(-${transactions.amount})`,
      count: sql<number>`count(*)::int`
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        cashFlowScope(),
        spendingSide(),
        gte(transactions.postedAt, new Date(from + 'T00:00:00')),
        lte(transactions.postedAt, new Date(to + 'T23:59:59'))
      )
    )
    .groupBy(transactions.normalizedKey)
    .orderBy(desc(sql`3`))
    .limit(limit);
  return rows.map((r) => ({
    key: r.key,
    name: cleanMerchant(r.name),
    spent: Number(r.spent),
    count: r.count,
    href: drillHref({ merchant: r.key, flow: 'out', from, to })
  }));
}
