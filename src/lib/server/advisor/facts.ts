import { and, desc, eq, gte, inArray, lt, min, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  accounts,
  categories,
  holdingSnapshots,
  recurringSeries,
  transactions,
  userPreferences
} from '../db/schema';
import { cashFlowScope } from '../cashflow';
import { budgetsForMonth } from '../budgets';
import { listGoals } from '../goals';
import { listLoans, type Loan } from '../loans';
import { monthlyEquivalent } from '../matching/recurring';
import { drillHref, isoDay } from '../../drill';
import { isManualKey } from '../recurringUser';
import { seriesState } from '../../recurringState';
import { accountDisplayName } from '../../accountName';
import { cleanMerchant } from '../../merchantName';
import { assetClass, ASSET_CLASSES, type AssetClass } from '../../assetClass';
import { classifyFlow } from '../../investmentFlow';
import {
  addDays,
  daysBetween,
  daysInMonth,
  dayOfMonth,
  median,
  monthsLater,
  onDayOfMonth,
  rollForward
} from '../../advisor/days';
import { detectPaychecks, expectedPay, type PaySeries } from '../../advisor/paychecks';
import { forecastCash, lowestPoint, type CashEvent, type ForecastPoint } from '../../advisor/forecast';
import { checkup, PACE_FROM_DAY, type CheckupInput, type Finding } from '../../advisor/checkup';

/**
 * The advisor's facts: everything it knows, worked out by the app.
 *
 * One read of the ledger (`ledger()`) feeds every cash-flow figure here, and
 * it reads through `cashFlowScope()` -- the same predicate as the dashboard,
 * Envelopes and the transactions drill-down -- so an advisor figure and the
 * list behind its link cannot disagree. Windows are whole local days, as the
 * drill-down requires.
 *
 * Nothing in this file talks to the model. The checkup is built from it alone,
 * and the model's tools (tools.ts) read it and pass on the results.
 */

/** Checking the forecast should not fall below, unless the user set another
 *  in Settings or the question names one. */
export const DEFAULT_FLOOR = Number(process.env.ADVISOR_FLOOR ?? 500);

/** Sets the floor ("Floor is set in Settings", 7b); null goes back to the default. */
export async function setUserFloor(floor: number | null): Promise<void> {
  const value = floor === null ? null : floor.toFixed(2);
  await db
    .insert(userPreferences)
    .values({ advisorFloor: value })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { advisorFloor: value, updatedAt: new Date() } });
}

export async function userFloor(): Promise<number> {
  const [row] = await db.select({ floor: userPreferences.advisorFloor }).from(userPreferences).limit(1);
  return row?.floor != null ? Number(row.floor) : DEFAULT_FLOOR;
}

export type { Gap } from '../../advisor/answer';
import type { Gap } from '../../advisor/answer';
/** Averages look back this far, or to the start of the history if shorter. */
const BASELINE_DAYS = 90;

const startOfDay = (day: string) => new Date(day + 'T00:00:00');
const round2 = (v: number) => Math.round(v * 100) / 100;

export function today(): string {
  return isoDay(new Date());
}

// ---- where the money is ---------------------------------------------------

export interface AccountLine {
  id: string;
  name: string;
  type: string;
  balance: number;
  /** A deposit account named as savings (or a money market). */
  savings: boolean;
}

const SAVINGS = /sav|money market|reserve/i;

export interface Position {
  /** Deposit accounts. */
  deposits: number;
  /** Owed on cards, positive. A card in credit counts as money back. */
  cardOwed: number;
  /** Deposits less card balances. */
  cash: number;
  /** The emergency fund: savings accounts, or every deposit account when
   *  none is called savings. `name` is how the checkup names it. */
  savings: { balance: number; name: string };
  /** Deposit accounts that are not savings. */
  checking: number;
  loansOwed: number;
  investments: number;
  netWorth: number;
  accounts: AccountLine[];
}

export async function position(): Promise<Position> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      nickname: accounts.nickname,
      orgName: accounts.orgName,
      type: accounts.type,
      balance: accounts.balance
    })
    .from(accounts)
    .where(eq(accounts.isActive, true));

  const lines = rows.map((r) => ({
    id: r.id,
    name: accountDisplayName(r),
    type: r.type,
    balance: Number(r.balance ?? 0),
    savings: r.type === 'depository' && SAVINGS.test(`${r.nickname ?? ''} ${r.name}`)
  }));
  const sum = (type: string) => lines.filter((l) => l.type === type).reduce((s, l) => s + l.balance, 0);
  const deposits = sum('depository');
  const cards = sum('credit');
  const saved = lines.filter((l) => l.savings);
  return {
    deposits: round2(deposits),
    cardOwed: round2(-cards),
    cash: round2(deposits + cards),
    savings: saved.length
      ? { balance: round2(saved.reduce((s, l) => s + l.balance, 0)), name: saved.length === 1 ? saved[0].name : 'Savings' }
      : { balance: round2(deposits), name: 'Cash' },
    checking: round2(lines.filter((l) => l.type === 'depository' && !l.savings).reduce((s, l) => s + l.balance, 0)),
    loansOwed: round2(-sum('loan')),
    investments: round2(sum('investment')),
    netWorth: round2(lines.reduce((s, l) => s + l.balance, 0)),
    accounts: lines
  };
}

// ---- the ledger ------------------------------------------------------------

export interface LedgerRow {
  day: string;
  amount: number;
  categoryId: string | null;
  category: string;
  key: string;
  merchant: string;
  accountId: string;
  accountType: string;
}

export interface Ledger {
  today: string;
  /** First day of history on a deposit or card account; null with none. */
  firstDay: string | null;
  historyDays: number;
  rows: LedgerRow[];
  /** The averaging window: whole days, `to` inclusive. */
  window: { from: string; to: string; days: number };
}

/**
 * Every cash-flow row since the first of the month four months back -- enough
 * for three whole months plus this one -- through `cashFlowScope()`.
 */
export async function ledger(day = today()): Promise<Ledger> {
  const [first] = await db
    .select({ at: min(transactions.postedAt) })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    // Cash-flow accounts only: a loan's or a brokerage's old payments say
    // nothing about how much spending history there is to average.
    .where(and(inArray(accounts.type, ['depository', 'credit']), eq(transactions.pending, false)));
  const firstDay = first?.at ? isoDay(new Date(first.at)) : null;

  // Seven months back: three whole months, the three before them, and this one.
  const since = monthsLater(day, -7);
  const raw = await db
    .select({
      postedAt: transactions.postedAt,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      category: categories.name,
      key: transactions.normalizedKey,
      merchantName: transactions.merchantName,
      description: transactions.description,
      accountId: transactions.accountId,
      accountType: accounts.type
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        cashFlowScope(),
        gte(transactions.postedAt, startOfDay(since)),
        lt(transactions.postedAt, startOfDay(addDays(day, 1)))
      )
    );

  const rows: LedgerRow[] = raw.map((r) => ({
    day: isoDay(r.postedAt),
    amount: Number(r.amount),
    categoryId: r.categoryId,
    category: r.category ?? 'Uncategorized',
    key: r.key,
    merchant: cleanMerchant(r.merchantName || r.description),
    accountId: r.accountId,
    accountType: r.accountType
  }));

  const historyDays = firstDay ? daysBetween(firstDay, day) + 1 : 0;
  const from = firstDay && firstDay > addDays(day, -BASELINE_DAYS + 1) ? firstDay : addDays(day, -BASELINE_DAYS + 1);
  return {
    today: day,
    firstDay,
    historyDays,
    rows,
    window: { from, to: day, days: daysBetween(from, day) + 1 }
  };
}

const isIncome = (r: LedgerRow) => r.amount > 0 && r.accountType === 'depository';
const isSpending = (r: LedgerRow) => r.amount < 0;
const inRange = (r: LedgerRow, from: string, to: string) => r.day >= from && r.day <= to;

export interface Baseline {
  from: string;
  to: string;
  days: number;
  income: number;
  spending: number;
  /** Per 30.44 days. */
  monthlyIncome: number;
  monthlySpending: number;
  /** Everyday spending that follows no schedule, per day. */
  everydayPerDay: number;
  incomeHref: string;
  spendingHref: string;
}

/**
 * Averages over the window. Everyday spending is the part no recurring series
 * explains, taken as the median week rather than the mean, so one vacation or
 * one new sofa does not set the forecast's burn rate for the next two months.
 */
export function baseline(l: Ledger, recurringKeys: Set<string>): Baseline {
  const { from, to, days } = l.window;
  const rows = l.rows.filter((r) => inRange(r, from, to));
  const income = rows.filter(isIncome).reduce((s, r) => s + r.amount, 0);
  const spending = rows.filter(isSpending).reduce((s, r) => s - r.amount, 0);

  const everyday = rows.filter((r) => isSpending(r) && !recurringKeys.has(`${r.accountId}::${r.key}`));
  const weeks = Math.floor(days / 7);
  let perDay: number;
  if (weeks >= 4) {
    // Whole weeks counted back from the window's end.
    const totals = Array.from({ length: weeks }, (_, w) => {
      const end = addDays(to, -7 * w);
      const start = addDays(end, -6);
      return everyday.filter((r) => inRange(r, start, end)).reduce((s, r) => s - r.amount, 0);
    });
    perDay = median(totals) / 7;
  } else {
    perDay = everyday.reduce((s, r) => s - r.amount, 0) / Math.max(days, 1);
  }

  return {
    from,
    to,
    days,
    income: round2(income),
    spending: round2(spending),
    monthlyIncome: round2((income / days) * 30.44),
    monthlySpending: round2((spending / days) * 30.44),
    everydayPerDay: round2(perDay),
    incomeHref: drillHref({ from, to, flow: 'in' }),
    spendingHref: drillHref({ from, to, flow: 'out' })
  };
}

// ---- what is coming --------------------------------------------------------

export interface Bill {
  id: string;
  key: string;
  accountId: string | null;
  name: string;
  cadenceDays: number;
  amount: number;
  usual: number;
  changed: boolean;
  suspected: boolean;
  lastSeen: string;
  categoryId: string | null;
  href: string;
  /** Added by hand: no transactions behind it, paid on its due date. */
  manual: boolean;
  /** A hand-added bill's first due date; nothing is due before it. */
  startsOn: string | null;
  missed: string | null;
}

export async function bills(): Promise<Bill[]> {
  const rows = await db
    .select()
    .from(recurringSeries)
    .where(inArray(recurringSeries.status, ['active', 'suspected']));
  const live = new Set(
    (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.isActive, true))).map((a) => a.id)
  );
  const day = today();
  // Is it still recurring? ($lib/recurringState) A series that has missed two
  // cycles is gone from every total even before the next sync ends it; one
  // that missed one is still expected, and says so.
  const state = (r: (typeof rows)[number]) =>
    isManualKey(r.normalizedKey) ? null : seriesState(isoDay(r.lastSeen), r.cadenceDays, day);
  return rows
    .filter((r) => !r.accountId || live.has(r.accountId))
    .filter((r) => state(r)?.state !== 'stopped')
    .map((r) => ({
      id: r.id,
      key: r.normalizedKey,
      accountId: r.accountId,
      name: cleanMerchant(r.merchantName),
      cadenceDays: r.cadenceDays,
      amount: Number(r.lastAmount),
      usual: Number(r.averageAmount),
      changed: r.amountChanged,
      suspected: r.status === 'suspected',
      // A bill added by hand never posts, so it counts as paid on each due
      // date: its schedule rolls forward here rather than waiting for a sync.
      lastSeen: isManualKey(r.normalizedKey)
        ? rollForward(isoDay(r.lastSeen), r.cadenceDays, today())
        : isoDay(r.lastSeen),
      categoryId: r.categoryId,
      // No rows behind a hand-added bill: its link is the recurring calendar.
      href: isManualKey(r.normalizedKey)
        ? '/plan?tab=recurring'
        : drillHref({ merchant: r.normalizedKey, account: r.accountId }),
      manual: isManualKey(r.normalizedKey),
      startsOn: isManualKey(r.normalizedKey) ? isoDay(r.firstSeen) : null,
      /** The date a charge was expected and did not come: "may have stopped". */
      missed: state(r)?.state === 'missed' ? state(r)!.expected : null
    }));
}

/** Dates after `last` on a cadence, through `until`. Monthly keeps its day of
 *  the month rather than drifting by 30-day steps. */
function scheduleFrom(last: string, cadenceDays: number, until: string): string[] {
  const out: string[] = [];
  if (cadenceDays === 30) {
    const dom = dayOfMonth(last);
    for (let m = 1; m < 36; m++) {
      const d = onDayOfMonth(monthsLater(last, m), dom);
      if (d > until) break;
      out.push(d);
    }
    return out;
  }
  for (let d = addDays(last, cadenceDays); d <= until; d = addDays(d, cadenceDays)) out.push(d);
  return out;
}

/**
 * A charge already due that has not posted is placed tomorrow if it is only a
 * few days late (billing slides, feeds lag), and dropped once it is later than
 * that: a series that stopped should not keep a forecast pessimistic.
 */
function placeDue(day: string, today: string, grace: number): { day: string; late: boolean } | null {
  if (day >= today) return { day, late: false };
  if (daysBetween(day, today) <= grace) return { day: addDays(today, 1), late: true };
  return null;
}

export interface Outlook {
  /** The checking account the forecast follows; null with none. */
  account: { id: string; name: string } | null;
  start: number;
  points: ForecastPoint[];
  events: CashEvent[];
  everydayPerDay: number;
  paychecks: PaySeries[];
  notes: string[];
  gaps: Gap[];
}

/**
 * Money moved out of checking to the household's own accounts on a monthly
 * schedule: the card autopay, the transfer to savings or the brokerage. Found
 * from transfer legs -- `detectRecurring()` never sees them, rightly -- and
 * projected on the day of the month they usually go. A card payment is taken
 * as the card's current balance, since that is what the next one settles.
 */
interface Mover {
  to: string;
  toType: string;
  amount: number;
  dom: number;
  last: string;
}

async function movers(accountId: string, since: string, cardOwed: Map<string, number>): Promise<Mover[]> {
  const outs = await db
    .select({ postedAt: transactions.postedAt, amount: transactions.amount, groupId: transactions.transferGroupId })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.isTransfer, true),
        eq(transactions.pending, false),
        lt(transactions.amount, '0'),
        gte(transactions.postedAt, startOfDay(since))
      )
    );
  const groups = [...new Set(outs.map((o) => o.groupId).filter((g): g is string => !!g))];
  if (!groups.length) return [];
  // The other leg of each, for where it went. Two plain queries joined in
  // memory rather than a correlated subquery.
  const legs = await db
    .select({
      groupId: transactions.transferGroupId,
      accountId: accounts.id,
      name: accounts.name,
      nickname: accounts.nickname,
      orgName: accounts.orgName,
      type: accounts.type
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(inArray(transactions.transferGroupId, groups), ne(transactions.accountId, accountId)));
  const legOf = new Map(legs.map((g) => [g.groupId!, g]));

  const byTarget = new Map<string, { leg: (typeof legs)[number]; rows: Array<{ day: string; amount: number }> }>();
  for (const o of outs) {
    const leg = o.groupId ? legOf.get(o.groupId) : undefined;
    // Loans are projected from the loan's own side (listLoans), not here.
    if (!leg || leg.type === 'loan') continue;
    const t = byTarget.get(leg.accountId) ?? { leg, rows: [] };
    t.rows.push({ day: isoDay(o.postedAt), amount: -Number(o.amount) });
    byTarget.set(leg.accountId, t);
  }

  const out: Mover[] = [];
  for (const [id, { leg, rows }] of byTarget) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => a.day.localeCompare(b.day));
    const gaps = rows.slice(1).map((x, k) => daysBetween(rows[k].day, x.day));
    // Monthly, give or take a few days.
    const gap = median(gaps);
    if (gap < 24 || gap > 36) continue;
    const owed = cardOwed.get(id);
    out.push({
      to: accountDisplayName(leg),
      toType: leg.type,
      amount: leg.type === 'credit' && owed !== undefined ? owed : median(rows.slice(-3).map((x) => x.amount)),
      dom: Math.round(median(rows.map((x) => dayOfMonth(x.day)))),
      last: rows[rows.length - 1].day
    });
  }
  return out;
}

/**
 * Checking, day by day (handoff 7b: "Everyday Checking, next 30 days").
 *
 * Checking is where a shortfall actually bites: a bill bounces there, not
 * against a net-worth figure. What moves it is paychecks landing in it, bills
 * charged to it, loan payments, card autopays and standing transfers leaving
 * it, and everyday debit spending at its recent rate. Card purchases reach
 * checking as the card payment, so they are not counted twice.
 */
export async function outlook(l: Ledger, days: number, extra: CashEvent[] = []): Promise<Outlook> {
  const until = addDays(l.today, days);
  const [pos, billRows, loans] = await Promise.all([position(), bills(), listLoans()]);

  const paychecks = detectPaychecks(
    l.rows.filter(isIncome).map((r) => ({ day: r.day, amount: r.amount, key: r.key, name: r.merchant, accountId: r.accountId })),
    l.today
  );

  // The checking account: where the pay lands, else the biggest non-savings one.
  const payInto = new Map<string, number>();
  for (const p of paychecks) payInto.set(p.accountId, (payInto.get(p.accountId) ?? 0) + p.typical);
  const acct =
    pos.accounts
      .filter((a) => a.type === 'depository' && !a.savings)
      .sort((a, b) => (payInto.get(b.id) ?? 0) - (payInto.get(a.id) ?? 0) || b.balance - a.balance)[0] ?? null;
  if (!acct) {
    return {
      account: null,
      start: 0,
      points: [],
      events: [],
      everydayPerDay: 0,
      paychecks,
      notes: ['No checking account found, so there is nothing to forecast.'],
      gaps: [
        {
          key: 'checking',
          emoji: '🏦',
          title: 'A checking account',
          detail: 'Forecasts follow the account your pay lands in. Connect it on Bank link.'
        }
      ]
    };
  }

  const events: CashEvent[] = [];
  for (const p of expectedPay(paychecks.filter((x) => x.accountId === acct.id), l.today, until)) {
    events.push({
      day: p.day,
      amount: p.amount,
      label: p.series.name,
      kind: 'paycheck',
      estimated: p.late || undefined,
      href: drillHref({ merchant: p.series.key, account: p.series.accountId, flow: 'in' })
    });
  }

  const mine = billRows.filter((b) => b.accountId === acct.id);
  for (const b of mine) {
    const grace = Math.max(3, Math.round(b.cadenceDays / 6));
    for (const d of scheduleFrom(b.lastSeen, b.cadenceDays, until)) {
      const at = placeDue(d, l.today, grace);
      if (!at) continue;
      events.push({
        day: at.day,
        amount: -b.amount,
        label: b.name,
        kind: 'bill',
        estimated: b.suspected || at.late || undefined,
        href: b.href
      });
    }
  }

  for (const loan of loans) {
    if (loan.paidOff || !loan.payment || !loan.nextDue) continue;
    if (loan.fromAccount && loan.fromAccount.id !== acct.id) continue;
    for (const d of [loan.nextDue, ...scheduleFrom(loan.nextDue, 30, until)]) {
      const at = placeDue(d, l.today, d === loan.nextDue ? 10 : 0);
      if (!at || at.day > until) continue;
      events.push({
        day: at.day,
        amount: -loan.payment,
        label: loanName(loan),
        kind: 'loan',
        estimated: at.late || undefined,
        href: '/wealth'
      });
    }
  }

  const cardOwed = new Map(pos.accounts.filter((a) => a.type === 'credit').map((a) => [a.id, Math.max(0, -a.balance)]));
  for (const m of await movers(acct.id, addDays(l.today, -100), cardOwed)) {
    if (m.amount < 0.01) continue;
    for (let k = 0; k < 3; k++) {
      const d = onDayOfMonth(monthsLater(l.today, k), m.dom);
      if (d > until) break;
      if (d <= m.last) continue;
      const at = placeDue(d, l.today, 3);
      if (!at) continue;
      events.push({
        day: at.day,
        amount: -m.amount,
        // A card payment is a bill as far as checking is concerned (7b lists it
        // under Going out); money to savings or the brokerage is Moving.
        label: m.toType === 'credit' ? `${m.to} bill` : `To ${m.to}`,
        kind: m.toType === 'credit' ? 'bill' : 'transfer',
        estimated: m.toType === 'credit' || at.late || undefined,
        href: null
      });
      // The payment after this one settles spending not made yet, which the
      // forecast cannot know. One is enough inside 30-60 days.
      if (m.toType === 'credit') break;
    }
  }

  // Everyday spending straight out of checking: debit purchases that are no
  // recurring series. The median week, so one big purchase does not set the
  // rate for the next two months.
  const recurring = new Set(billRows.map((b) => `${b.accountId}::${b.key}`));
  const { from, to, days: span } = l.window;
  const everyday = l.rows.filter(
    (r) => r.accountId === acct.id && r.amount < 0 && inRange(r, from, to) && !recurring.has(`${r.accountId}::${r.key}`)
  );
  const weeks = Math.floor(span / 7);
  const perDay = round2(
    weeks >= 4
      ? median(
          Array.from({ length: weeks }, (_, w) => {
            const end = addDays(to, -7 * w);
            return everyday.filter((r) => inRange(r, addDays(end, -6), end)).reduce((s, r) => s - r.amount, 0);
          })
        ) / 7
      : everyday.reduce((s, r) => s - r.amount, 0) / Math.max(span, 1)
  );

  events.push(...extra);
  events.sort((a, b) => a.day.localeCompare(b.day));

  const gaps: Gap[] = [];
  if (!paychecks.some((p) => p.accountId === acct.id)) {
    gaps.push({
      key: 'paycheck',
      emoji: '💼',
      title: 'A paycheck',
      detail: 'No repeating deposit yet, so the forecast counts no income coming in.'
    });
  }
  if (l.historyDays < 60) {
    const since = new Date((l.firstDay ?? l.today) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    gaps.push({
      key: 'history',
      emoji: '📅',
      title: 'A bit more history',
      detail: `Forecasts firm up at 90 days. You have ${l.historyDays}, since ${since}. Nothing to do; it fills in with each sync.`
    });
  }
  if (mine.some((b) => b.suspected)) {
    gaps.push({
      key: 'suspected',
      emoji: '🔁',
      title: 'A second charge',
      detail: 'Some subscriptions have been charged once so far; they are assumed monthly until the next one.'
    });
  }
  const notes = gaps.map((g) => `${g.title} is missing: ${g.detail}`);

  return {
    account: { id: acct.id, name: acct.name },
    start: acct.balance,
    points: forecastCash(acct.balance, l.today, days, events, perDay),
    events,
    everydayPerDay: perDay,
    paychecks,
    notes,
    gaps
  };
}

/**
 * An answer's footnote: "Worked out from 90 days of Everyday Checking and 2
 * cards, through Sep 29." Names the account a forecast followed when there
 * was one.
 */
export async function answerBasis(account: string | null, own: string | null = null): Promise<string> {
  const l = await ledger();
  if (own) {
    const on = new Date(l.today + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${own}, through ${on}.`;
  }
  if (!l.firstDay) return 'No transactions yet.';
  const pos = await position();
  const cards = pos.accounts.filter((a) => a.type === 'credit').length;
  const cash = pos.accounts.filter((a) => a.type === 'depository' || a.type === 'credit').length;
  const days = Math.min(l.historyDays, l.window.days);
  const through = new Date(l.today + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const what = account
    ? `${account}${cards ? ` and ${cards} card${cards === 1 ? '' : 's'}` : ''}`
    : `${cash} account${cash === 1 ? '' : 's'}`;
  return `Worked out from ${days} days of ${what}, through ${through}.`;
}

export function loanName(loan: Loan): string {
  return accountDisplayName({ name: loan.name, nickname: loan.nickname, orgName: loan.orgName });
}

// ---- months ----------------------------------------------------------------

export interface MonthTotals {
  /** YYYY-MM */
  month: string;
  label: string;
  from: string;
  to: string;
  income: number;
  spending: number;
  byCategory: Map<string, { id: string | null; name: string; spent: number }>;
}

/** Whole months the history fully covers, oldest first, this month excluded. */
export function wholeMonths(l: Ledger, count = 3): MonthTotals[] {
  const out: MonthTotals[] = [];
  for (let k = count; k >= 1; k--) {
    const from = monthsLater(l.today, -k);
    const to = addDays(monthsLater(l.today, -k + 1), -1);
    if (!l.firstDay || l.firstDay > from) continue;
    out.push(monthTotals(l, from, to));
  }
  return out;
}

export function monthTotals(l: Ledger, from: string, to: string): MonthTotals {
  const rows = l.rows.filter((r) => inRange(r, from, to));
  const byCategory = new Map<string, { id: string | null; name: string; spent: number }>();
  for (const r of rows.filter(isSpending)) {
    const k = r.categoryId ?? 'none';
    const c = byCategory.get(k) ?? { id: r.categoryId, name: r.category, spent: 0 };
    c.spent -= r.amount;
    byCategory.set(k, c);
  }
  return {
    month: from.slice(0, 7),
    label: new Date(from + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }),
    from,
    to,
    income: round2(rows.filter(isIncome).reduce((s, r) => s + r.amount, 0)),
    spending: round2(rows.filter(isSpending).reduce((s, r) => s - r.amount, 0)),
    byCategory
  };
}

// ---- investments ------------------------------------------------------------

export interface InvestmentSummary {
  worth: number;
  accounts: Array<{ name: string; balance: number }>;
  asOf: string | null;
  mix: Array<{ key: AssetClass; label: string; value: number; share: number }>;
  /** Value and cost of the positions that report a purchase price. */
  costKnown: { value: number; cost: number } | null;
  /** Money put in over the last 90 days (contributions, rollovers, transfers in). */
  putIn90: number;
}

export async function investments(day = today()): Promise<InvestmentSummary | null> {
  const accts = await db
    .select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname, orgName: accounts.orgName, balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.type, 'investment'), eq(accounts.isActive, true)));
  if (!accts.length) return null;
  const ids = accts.map((a) => a.id);

  const snaps = await db
    .select()
    .from(holdingSnapshots)
    .where(inArray(holdingSnapshots.accountId, ids))
    .orderBy(desc(holdingSnapshots.asOf));
  const newest = new Map<string, string>();
  for (const h of snaps) if (!newest.has(h.accountId)) newest.set(h.accountId, h.asOf);
  const current = snaps.filter((h) => newest.get(h.accountId) === h.asOf);

  const byClass = new Map<AssetClass, number>();
  let value = 0;
  let cost = 0;
  for (const h of current) {
    const mv = Number(h.marketValue);
    const kind = assetClass(h.symbol, h.description);
    byClass.set(kind, (byClass.get(kind) ?? 0) + mv);
    if (h.purchasePrice !== null && kind !== 'cash') {
      value += mv;
      cost += Number(h.purchasePrice) * Number(h.shares);
    }
  }
  const total = [...byClass.values()].reduce((s, v) => s + v, 0);

  const since = addDays(day, -89);
  const flows = await db
    .select({ amount: transactions.amount, description: transactions.description, isTransfer: transactions.isTransfer })
    .from(transactions)
    .where(
      and(
        inArray(transactions.accountId, ids),
        eq(transactions.pending, false),
        eq(transactions.excluded, false),
        gte(transactions.postedAt, startOfDay(since))
      )
    );
  const putIn90 = flows
    .map((f) => ({ v: Number(f.amount), flow: classifyFlow(f.description, Number(f.amount), f.isTransfer) }))
    .filter((f) => f.flow === 'put-in' || f.flow === 'withdrawal')
    .reduce((s, f) => s + f.v, 0);

  return {
    worth: round2(accts.reduce((s, a) => s + Number(a.balance ?? 0), 0)),
    accounts: accts.map((a) => ({ name: accountDisplayName(a), balance: Number(a.balance ?? 0) })),
    asOf: [...newest.values()].sort().pop() ?? null,
    mix: ASSET_CLASSES.filter((c) => byClass.has(c.key)).map((c) => ({
      key: c.key,
      label: c.label,
      value: round2(byClass.get(c.key)!),
      share: total > 0 ? byClass.get(c.key)! / total : 0
    })),
    costKnown: cost > 0 ? { value: round2(value), cost: round2(cost) } : null,
    putIn90: round2(putIn90)
  };
}

// ---- the checkup -------------------------------------------------------------

export interface Checkup {
  /** Most urgent first. */
  findings: Finding[];
  /** Findings put away that still apply ("2 hidden · Show"). */
  hidden: Finding[];
  notes: string[];
  basis: string;
}

/** What an answer or a checkup rests on, in one line. */
export function basisLine(l: Ledger, accountCount: number): string {
  if (!l.firstDay) return 'No transactions yet.';
  const through = new Date(l.today + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const days = Math.min(l.historyDays, l.window.days);
  return `From ${days} days of ${accountCount} account${accountCount === 1 ? '' : 's'}, through ${through}.`;
}

/** A typical month's spending: the whole months' average, or the window's
 *  rate when history does not cover a whole month yet. */
export function averageMonth(l: Ledger, base: Baseline): number {
  const months = wholeMonths(l, 3);
  return months.length ? round2(months.reduce((s, m) => s + m.spending, 0) / months.length) : base.monthlySpending;
}

/** Recurring bills (monthly equivalent) plus loan payments. */
export function monthlyBills(billRows: Bill[], loans: Loan[]): number {
  return round2(
    billRows.reduce((s, b) => s + monthlyEquivalent(b.amount, b.cadenceDays), 0) + loanPaymentsMonthly(loans)
  );
}

export async function runCheckup(): Promise<Checkup> {
  const l = await ledger();
  const [look, pos, billRows, loans, envelopes, goalRows, dismissed, cats] = await Promise.all([
    outlook(l, 30),
    position(),
    bills(),
    listLoans(),
    budgetsForMonth(new Date()),
    listGoals(),
    dismissedFindings(),
    db.select({ id: categories.id, icon: categories.icon }).from(categories)
  ]);
  const iconOf = new Map(cats.map((c) => [c.id, c.icon]));
  const base = baseline(l, new Set(billRows.map((b) => `${b.accountId}::${b.key}`)));

  const monthFrom = monthsLater(l.today, 0);
  const monthTo = addDays(monthsLater(l.today, 1), -1);
  const dom = dayOfMonth(l.today);
  const thisMonth = monthTotals(l, monthFrom, l.today);

  let low: CheckupInput['low'] = null;
  if (look.points.length) {
    const p = lowestPoint(look.points);
    const before = look.events.filter((e) => e.amount < 0 && e.day <= p.day).sort((a, b) => a.amount - b.amount)[0];
    low = { day: p.day, balance: p.balance, before: before?.label ?? null };
  }

  // The last three whole months against the three before them.
  const six = wholeMonths(l, 6);
  const recent = six.slice(-3);
  const earlier = six.length >= 6 ? six.slice(0, 3) : null;
  const sum = (ms: MonthTotals[], k: 'income' | 'spending') => ms.reduce((s, m) => s + m[k], 0);
  let threePaychecks: string | null = null;
  if (recent.length) {
    const payKeys = new Set(look.paychecks.filter((p) => p.cadence === 'biweekly').map((p) => `${p.accountId}::${p.key}`));
    for (const m of recent) {
      const n = l.rows.filter((r) => isIncome(r) && inRange(r, m.from, m.to) && payKeys.has(`${r.accountId}::${r.key}`)).length;
      if (n >= 3) threePaychecks = m.label;
    }
  }

  const findings = checkup({
    today: l.today,
    historyDays: l.historyDays,
    savings: pos.savings,
    checking: pos.checking,
    averageMonth: averageMonth(l, base),
    monthlyBills: monthlyBills(billRows, loans),
    floor: DEFAULT_FLOOR,
    low,
    envelopes: envelopes.map((e) => ({
      categoryId: e.categoryId,
      name: e.name,
      emoji: e.icon,
      limit: e.amount,
      spent: e.spent,
      href: drillHref({ category: e.categoryId, from: monthFrom, to: monthTo, flow: 'out' })
    })),
    daysLeftInMonth: daysInMonth(l.today) - dom,
    resetDay: monthsLater(l.today, 1),
    priceChanges: billRows
      .filter((b) => b.changed && !b.suspected)
      .map((b) => ({
        id: b.id,
        name: b.name,
        emoji: b.categoryId ? (iconOf.get(b.categoryId) ?? null) : null,
        from: b.usual,
        to: b.amount,
        day: b.lastSeen,
        cadenceDays: b.cadenceDays,
        href: b.href
      })),
    kept: recent.length
      ? {
          months: recent.length,
          income: sum(recent, 'income'),
          spending: sum(recent, 'spending'),
          href: drillHref({ from: recent[0].from, to: recent[recent.length - 1].to, flow: 'out' }),
          before: earlier ? { income: sum(earlier, 'income'), spending: sum(earlier, 'spending') } : null,
          threePaychecks
        }
      : null,
    pace:
      dom >= PACE_FROM_DAY && l.historyDays >= 60
        ? {
            spent: thisMonth.spending,
            projected: (thisMonth.spending / dom) * daysInMonth(l.today),
            typical: averageMonth(l, base),
            day: dom,
            days: daysInMonth(l.today),
            href: drillHref({ from: monthFrom, to: l.today, flow: 'out' })
          }
        : null,
    goalsBehind: goalRows
      .filter((g) => g.status === 'active' && g.onTrack === false && g.requiredPerMonth && g.pacePerMonth !== null)
      .map((g) => ({ id: g.id, name: g.name, needed: g.requiredPerMonth!, pace: g.pacePerMonth! }))
  });

  const put = new Set(dismissed);
  return {
    findings: findings.filter((f) => !put.has(f.key)),
    hidden: findings.filter((f) => put.has(f.key)),
    notes: look.notes,
    basis: basisLine(l, pos.accounts.filter((a) => a.type === 'depository' || a.type === 'credit').length)
  };
}

// ---- dismissals ----------------------------------------------------------------

/** Keys stay a bounded list: the oldest fall off, and since keys carry a month
 *  or a price, an old one would never match again anyway. */
const MAX_DISMISSED = 200;

export async function dismissedFindings(): Promise<string[]> {
  const [row] = await db
    .select({ keys: userPreferences.dismissedFindings })
    .from(userPreferences)
    .limit(1);
  return row?.keys ?? [];
}

export async function dismissFinding(key: string): Promise<void> {
  const keys = [...(await dismissedFindings()).filter((k) => k !== key), key].slice(-MAX_DISMISSED);
  await db
    .insert(userPreferences)
    .values({ dismissedFindings: keys })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { dismissedFindings: keys, updatedAt: new Date() }
    });
}

/** Undo, and "N hidden · Show": puts findings back. */
export async function restoreFindings(keys: string[]): Promise<void> {
  const drop = new Set(keys);
  const left = (await dismissedFindings()).filter((k) => !drop.has(k));
  await db
    .insert(userPreferences)
    .values({ dismissedFindings: left })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { dismissedFindings: left, updatedAt: new Date() } });
}

/** Loan payments per month, for outflow figures. Payments stay out of
 *  spending everywhere; this is the one place they are added beside it. */
export function loanPaymentsMonthly(loans: Loan[]): number {
  return round2(loans.filter((x) => x.owed >= 0.01 && x.payment).reduce((s, x) => s + (x.payment ?? 0), 0));
}

export { monthlyEquivalent };

export interface CheckupSummary {
  action: number;
  look: number;
  good: number;
  /** How many findings the checkup shows. */
  count: number;
  /**
   * The top finding for the dashboard card (7r/7s): the highest-ranked one
   * not already on the dashboard's own "Needs a look" card, which covers
   * envelopes.
   */
  top: Finding | null;
}

export async function checkupSummary(): Promise<CheckupSummary> {
  const { findings } = await runCheckup();
  const shown = findings.slice(0, 5);
  return {
    action: shown.filter((f) => f.severity === 'action').length,
    look: shown.filter((f) => f.severity === 'look').length,
    good: shown.filter((f) => f.severity === 'good').length,
    count: shown.length,
    top: findings.find((f) => !f.key.startsWith('env-')) ?? null
  };
}

/**
 * What actually reached the savings accounts: their net change from posted
 * transactions over the last `days`, as a monthly rate. Transfers count here
 * -- they are exactly how money gets into savings -- which is why this reads
 * the accounts directly rather than the cash-flow ledger. Split parts are
 * left out; the parent already moved the balance.
 */
export async function savingsInflow(days = 90): Promise<{ perMonth: number; total: number; days: number } | null> {
  const pos = await position();
  const ids = pos.accounts.filter((a) => a.savings).map((a) => a.id);
  if (!ids.length) return null;
  const since = startOfDay(addDays(today(), -days + 1));
  const [row] = await db
    .select({ net: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        inArray(transactions.accountId, ids),
        gte(transactions.postedAt, since),
        eq(transactions.pending, false),
        ne(transactions.provider, 'split')
      )
    );
  const total = Number(row?.net ?? 0);
  return { perMonth: round2((total / days) * 30.44), total: round2(total), days };
}
