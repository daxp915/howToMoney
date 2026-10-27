/**
 * The month as a plan (v2): what is expected in, what is assigned to bills,
 * everyday spending and savings, what is left to assign, and the spending
 * pace Home draws. Home and Plan both read this, so "$4,615 budgeted" on Home
 * and the BILLS + EVERYDAY groups on Plan are one calculation.
 *
 * - **Bills vs everyday.** A category is a bill when its name says so (rent,
 *   utilities, phone, insurance, subscriptions) or when the recurring charges
 *   filed under it cover most of its budget -- a gym membership in "Fitness".
 *   Bills count on their due date; everything else is spread evenly through
 *   the month. That is the pace rule: rent paid on the 1st must not read as
 *   "over pace" on the 2nd.
 * - **Savings** are the active goals, each asking for what its target date
 *   needs this month and credited with what reached its account this month.
 * - **Expected income** is what has arrived this month plus the paychecks
 *   still due (detectPaychecks), or the three-month average when no paycheck
 *   pattern is known yet.
 *
 * Every figure comes with the drill-down href of the rows behind it.
 */
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from './db';
import { categories, transactions } from './db/schema';
import { budgetsForMonth } from './budgets';
import { listGoals } from './goals';
import { bills, ledger, wholeMonths, type LedgerRow } from './advisor/facts';
import { detectPaychecks, expectedPay, payBasis } from '../advisor/paychecks';
import { addDays, dayOfMonth, stepCadence } from '../advisor/days';
import { drillHref } from '../drill';

/** Category names that are bills whatever their history says. */
const BILL_NAMES = [
  /rent|mortgage/i,
  /utilit/i,
  /internet|phone/i,
  /insurance/i,
  /subscription/i,
  /loan/i,
  /child ?care|tuition/i
];

/** A category whose name alone says it is a bill. */
export const isBillName = (name: string) => BILL_NAMES.some((re) => re.test(name));

/** Recurring charges covering this share of a category make it a bill. */
const RECURRING_SHARE = 0.7;

export interface PlanCategory {
  id: string;
  name: string;
  icon: string | null;
  budget: number;
  spent: number;
  bill: boolean;
  /** Day of the month a bill is due, when its recurring charge says so. */
  dueDay: number | null;
  /** No limit set: the budget shown is the recurring charge's own amount. */
  suggested: boolean;
  href: string;
}

export interface PlanGoal {
  id: string;
  name: string;
  /** This month's ask: what the target date needs per month. */
  budget: number;
  /** What reached the goal's account this month. */
  spent: number;
  href: string | null;
}

export interface PlanMonth {
  /** YYYY-MM-DD of the 1st, and of the last day. */
  from: string;
  to: string;
  label: string;
  days: number;
  /** Day of the month today (the whole month if it is past). */
  day: number;
  bills: PlanCategory[];
  everyday: PlanCategory[];
  savings: PlanGoal[];
  /** Budgets with no limit set, for Plan's "+ add" list. */
  unbudgeted: PlanCategory[];
  income: { received: number; expected: number; href: string; fromPaychecks: boolean };
  /** Bills + everyday budgets: Home's "out of $X budgeted". */
  budgeted: number;
  /** Bills + everyday + savings asks. */
  assigned: number;
  toAssign: number;
  /** All spending this month (the cash-flow scope), and its rows. */
  spent: number;
  spentHref: string;
  pace: Pace;
}

export interface Pace {
  /** Cumulative spending, index 0 = day 1, through today. */
  actual: number[];
  /** Last month, cumulative, its whole length. */
  last: number[];
  lastLabel: string;
  /** Where spending would be by each day of this month on plan. */
  expected: number[];
  /** expected(today) - actual(today): positive is under. */
  under: number;
  /** The bills counted on their due dates, for the tip and Plan. */
  flexible: number;
}

const iso = (d: Date) => d.toLocaleDateString('en-CA');

function monthOf(now: Date) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { first, last, from: iso(first), to: iso(last), days: last.getDate() };
}

const isIncome = (r: LedgerRow) => r.amount > 0 && r.accountType === 'depository';
const isSpending = (r: LedgerRow) => r.amount < 0;

/** Cumulative spending per day of a month, `length` days. */
function cumulative(rows: LedgerRow[], from: string, length: number): number[] {
  const perDay = new Array(length).fill(0);
  for (const r of rows) {
    if (!isSpending(r) || r.day < from) continue;
    const i = dayOfMonth(r.day) - 1;
    if (r.day.slice(0, 7) === from.slice(0, 7) && i < length) perDay[i] -= r.amount;
  }
  let run = 0;
  return perDay.map((v) => (run += v));
}

export async function planMonth(now = new Date()): Promise<PlanMonth> {
  const m = monthOf(now);
  const today = iso(now);
  const isCurrent = today >= m.from && today <= m.to;
  const day = isCurrent ? now.getDate() : today > m.to ? m.days : 0;

  const [budgetRows, l, series, goals] = await Promise.all([
    budgetsForMonth(m.first),
    ledger(isCurrent ? today : m.to),
    bills(),
    listGoals(now)
  ]);

  // ---- bills vs everyday ----------------------------------------------------
  // Recurring charges per category, per month, and the day each is due.
  const recurByCat = new Map<string, { monthly: number; dueDay: number | null }>();
  for (const s of series) {
    if (!s.categoryId || s.suspected) continue;
    const e = recurByCat.get(s.categoryId) ?? { monthly: 0, dueDay: null };
    // The latest charge, not the average: rent that went up last month is
    // the new rent.
    const monthlyCadence = s.cadenceDays >= 26 && s.cadenceDays <= 35;
    e.monthly += monthlyCadence ? s.amount : (s.amount * 30.44) / Math.max(s.cadenceDays, 1);
    if (s.cadenceDays >= 26 && s.cadenceDays <= 35) {
      const dom = dayOfMonth(s.lastSeen);
      e.dueDay = e.dueDay === null ? dom : Math.min(e.dueDay, dom);
    }
    recurByCat.set(s.categoryId, e);
  }

  // Three months' average spending per category, for categories with no
  // budget yet to compare their recurring charges against.
  const months = wholeMonths(l, 3);
  const avgSpent = new Map<string, number>();
  for (const mt of months)
    for (const c of mt.byCategory.values())
      if (c.id) avgSpent.set(c.id, (avgSpent.get(c.id) ?? 0) + c.spent / months.length);

  const cats: PlanCategory[] = budgetRows.map((b) => {
    const rec = recurByCat.get(b.categoryId);
    const base = b.amount > 0 ? b.amount : (avgSpent.get(b.categoryId) ?? 0);
    const bill =
      BILL_NAMES.some((re) => re.test(b.name)) ||
      (!!rec && base > 0 && rec.monthly >= RECURRING_SHARE * base);
    // A bill nobody has set a limit on still arrives: its recurring charge is
    // the plan for it, so rent is expected on the 1st rather than reading as
    // "over" the moment it posts.
    const suggested = bill && b.amount <= 0 && !!rec && rec.monthly > 0;
    return {
      id: b.categoryId,
      name: b.name,
      icon: b.icon,
      budget: suggested ? Math.round(rec!.monthly) : b.amount,
      spent: b.spent,
      bill,
      dueDay: bill ? (rec?.dueDay ?? null) : null,
      suggested,
      href: drillHref({ category: b.categoryId, from: m.from, to: m.to, flow: 'out' })
    };
  });
  const budgeted = cats.filter((c) => c.budget > 0);
  const billCats = budgeted.filter((c) => c.bill).sort((a, b) => (a.dueDay ?? 99) - (b.dueDay ?? 99));
  const everyday = budgeted.filter((c) => !c.bill);
  const unbudgeted = cats.filter((c) => c.budget <= 0);

  // ---- savings ---------------------------------------------------------------
  const active = goals.filter((g) => g.status === 'active' && !g.achieved);
  const linked = active.map((g) => g.accountId).filter((id): id is string => !!id);
  const movedRows = linked.length
    ? await db
        .select({ id: transactions.accountId, net: sql<string>`sum(${transactions.amount})` })
        .from(transactions)
        .where(
          and(
            inArray(transactions.accountId, linked),
            gte(transactions.postedAt, m.first),
            lt(transactions.postedAt, new Date(m.last.getFullYear(), m.last.getMonth(), m.last.getDate() + 1)),
            eq(transactions.pending, false)
          )
        )
        .groupBy(transactions.accountId)
    : [];
  const moved = new Map(movedRows.map((r) => [r.id, Number(r.net)]));
  const savings: PlanGoal[] = active
    .filter((g) => (g.requiredPerMonth ?? 0) > 0)
    .map((g) => ({
      id: g.id,
      name: g.name,
      budget: Math.round(g.requiredPerMonth ?? 0),
      // A payoff goal's account is a loan: payments arrive positive there too.
      spent: Math.max(0, g.accountId ? (moved.get(g.accountId) ?? 0) : 0),
      href: g.accountId ? drillHref({ account: g.accountId, from: m.from, to: m.to }) : null
    }));

  // ---- income ------------------------------------------------------------------
  const inMonth = (r: LedgerRow) => r.day >= m.from && r.day <= m.to;
  const received = l.rows.filter((r) => inMonth(r) && isIncome(r)).reduce((s, r) => s + r.amount, 0);
  const paySeries = detectPaychecks(
    l.rows
      .filter(isIncome)
      .map((r) => ({ day: r.day, amount: r.amount, key: r.key, name: r.merchant, accountId: r.accountId })),
    isCurrent ? today : m.to
  );
  const stillDue = isCurrent
    ? expectedPay(paySeries, today, m.to)
        .filter((p) => p.day > today && p.day <= m.to)
        .reduce((s, p) => s + p.amount, 0)
    : 0;
  const avgIncome = months.length ? months.reduce((s, x) => s + x.income, 0) / months.length : 0;
  const fromPaychecks = paySeries.length > 0;
  const expected = fromPaychecks ? received + stillDue : Math.max(received, avgIncome);

  // ---- pace --------------------------------------------------------------------
  const monthRows = l.rows.filter(inMonth);
  const actual = cumulative(monthRows, m.from, Math.max(day, 0));
  const prevFirst = new Date(m.first.getFullYear(), m.first.getMonth() - 1, 1);
  const prev = monthOf(prevFirst);
  const last = cumulative(
    l.rows.filter((r) => r.day >= prev.from && r.day <= prev.to),
    prev.from,
    prev.days
  );
  const flexible = everyday.reduce((s, c) => s + c.budget, 0);
  // A bill with no known due day is spread like everyday spending.
  const undated = billCats.filter((c) => c.dueDay === null).reduce((s, c) => s + c.budget, 0);
  const expectedLine = Array.from({ length: m.days }, (_, i) => {
    const d = i + 1;
    const dueBy = billCats
      .filter((c) => c.dueDay !== null && c.dueDay <= d)
      .reduce((s, c) => s + c.budget, 0);
    return dueBy + ((flexible + undated) * d) / m.days;
  });
  const now$ = actual.length ? actual[actual.length - 1] : 0;
  const under = day > 0 ? expectedLine[day - 1] - now$ : 0;

  const budgetedTotal = billCats.concat(everyday).reduce((s, c) => s + c.budget, 0);
  const assigned = budgetedTotal + savings.reduce((s, g) => s + g.budget, 0);
  const spent = monthRows.filter(isSpending).reduce((s, r) => s - r.amount, 0);

  return {
    from: m.from,
    to: m.to,
    label: m.first.toLocaleDateString('en-US', { month: 'long' }),
    days: m.days,
    day,
    bills: billCats,
    everyday,
    savings,
    unbudgeted,
    income: {
      received,
      expected,
      href: drillHref({ from: m.from, to: m.to, flow: 'in' }),
      fromPaychecks
    },
    budgeted: budgetedTotal,
    assigned,
    toAssign: expected - assigned,
    spent,
    spentHref: drillHref({ from: m.from, to: addDays(m.to, 0), flow: 'out' }),
    pace: {
      actual,
      last,
      lastLabel: prevFirst.toLocaleDateString('en-US', { month: 'long' }),
      expected: expectedLine,
      under,
      flexible
    }
  };
}

// ---- recurring: the month's calendar and the next few days -----------------

export interface PlanEvent {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  emoji: string;
  /** Signed: a bill is negative, a paycheck positive. */
  amount: number;
  kind: 'bill' | 'pay' | 'loan';
  paid: boolean;
  /** "~$140" when the amount varies. */
  estimate: boolean;
  href: string;
  /** A recurring bill's series, for its action sheet ("Ignore this series"). */
  series?: { id: string; cadenceDays: number; usual: number; next: string; manual?: boolean };
  /**
   * Set on everything not yet paid: its date is the app's guess from past
   * charges or paychecks, and the page says so, with this as the reason.
   */
  predicted?: string;
  /** A paycheck already due that has not shown up; placed tomorrow. */
  late?: boolean;
}

const cadenceWords = (days: number) =>
  days >= 26 && days <= 35
    ? 'monthly'
    : days >= 12 && days <= 16
      ? 'every two weeks'
      : days >= 6 && days <= 8
        ? 'weekly'
        : days >= 80 && days <= 100
          ? 'every 3 months'
          : days >= 335 && days <= 395
            ? 'yearly'
            : `every ${days} days`;
const shortDate = (day: string) =>
  new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/**
 * Every bill, loan payment and paycheck this month: paid ones on the day
 * they posted, the rest on the day they are due. Active recurring series only
 * -- a suspected one has not earned a place on the calendar yet.
 */
export async function monthEvents(now = new Date()): Promise<PlanEvent[]> {
  const m = monthOf(now);
  const today = iso(now);
  const [series, budgetRows, l] = await Promise.all([bills(), budgetsForMonth(m.first), ledger(today)]);
  const icon = new Map(budgetRows.map((b) => [b.categoryId, b.icon]));
  const out: PlanEvent[] = [];

  for (const s of series) {
    if (s.suspected) continue;
    const emoji = (s.categoryId && icon.get(s.categoryId)) || '🔁';
    const base = {
      name: s.name,
      emoji,
      kind: 'bill' as const,
      estimate: s.changed || Math.abs(s.amount - s.usual) > 1,
      href: s.href,
      series: {
        id: s.id,
        cadenceDays: s.cadenceDays,
        usual: s.usual,
        next: s.manual && s.startsOn && s.startsOn > today ? s.startsOn : nextCharge(s.lastSeen, s.cadenceDays, today),
        manual: s.manual
      }
    };
    const predicted = `Predicted from past charges · ${cadenceWords(s.cadenceDays)}, last on ${shortDate(s.lastSeen)}`;
    if (s.cadenceDays >= 26 && s.cadenceDays <= 35) {
      const paidThisMonth = s.lastSeen >= m.from && s.lastSeen <= m.to;
      const dom = Math.min(dayOfMonth(s.lastSeen), m.days);
      const date = paidThisMonth ? s.lastSeen : `${m.from.slice(0, 8)}${String(dom).padStart(2, '0')}`;
      out.push({
        ...base,
        date,
        amount: -(paidThisMonth ? s.amount : s.usual),
        paid: paidThisMonth,
        ...(paidThisMonth ? {} : { predicted })
      });
    } else if (s.cadenceDays > 35) {
      // Quarterly and yearly: on the calendar only in a month they fall in.
      const paidThisMonth = s.lastSeen >= m.from && s.lastSeen <= m.to;
      let date = paidThisMonth ? s.lastSeen : null;
      for (let k = 1; !date && k < 40; k++) {
        const d = stepCadence(s.lastSeen, s.cadenceDays, k);
        if (d > m.to) break;
        if (d >= m.from) date = d;
      }
      if (date)
        out.push({
          ...base,
          date,
          amount: -(paidThisMonth ? s.amount : s.usual),
          paid: paidThisMonth,
          ...(paidThisMonth ? {} : { predicted })
        });
    } else if (s.cadenceDays > 0 && s.cadenceDays < 26) {
      // Weekly and biweekly: walk the schedule through the month.
      let d = s.lastSeen;
      while (d >= m.from) d = addDays(d, -s.cadenceDays);
      for (d = addDays(d, s.cadenceDays); d <= m.to; d = addDays(d, s.cadenceDays)) {
        if (d < m.from) continue;
        const paid = d <= s.lastSeen;
        out.push({ ...base, date: d, amount: -(paid ? s.amount : s.usual), paid, ...(paid ? {} : { predicted }) });
      }
    }
  }

  // A bill added by hand is due from its first date on, and is never a guess:
  // the person said when. It counts as paid once the day has come.
  for (let i = out.length - 1; i >= 0; i--) {
    const e = out[i];
    const b = e.series && series.find((x) => x.id === e.series!.id);
    if (!b?.manual) continue;
    if (b.startsOn && e.date < b.startsOn) out.splice(i, 1);
    else {
      e.paid = e.date <= today;
      e.amount = -b.usual;
      e.estimate = false;
      if (e.paid) delete e.predicted;
      else e.predicted = `Added by hand · ${cadenceWords(b.cadenceDays)}`;
    }
  }

  // Paychecks: the ones that landed, and the ones still due.
  const deposits = l.rows
    .filter(isIncome)
    .map((r) => ({ day: r.day, amount: r.amount, key: r.key, name: r.merchant, accountId: r.accountId }));
  const pays = detectPaychecks(deposits, today);
  for (const p of pays) {
    for (const d of deposits.filter((x) => x.key === p.key && x.accountId === p.accountId && x.day >= m.from && x.day <= m.to))
      out.push({
        date: d.day,
        name: p.name,
        emoji: '💼',
        amount: d.amount,
        kind: 'pay',
        paid: true,
        estimate: false,
        href: drillHref({ merchant: p.key, account: p.accountId, from: m.from, to: m.to })
      });
    for (const e of expectedPay([p], today, m.to).filter((x) => x.day > today))
      out.push({
        date: e.day,
        name: p.name,
        emoji: '💼',
        amount: e.amount,
        kind: 'pay',
        paid: false,
        estimate: false,
        href: drillHref({ merchant: p.key, account: p.accountId }),
        predicted: e.late ? `Was due and has not arrived yet · ${payBasis(p)}` : payBasis(p),
        late: e.late
      });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
}

/** The first charge after today on the series' cadence; a monthly one keeps
 *  its day of the month. */
function nextCharge(last: string, cadenceDays: number, today: string): string {
  if (cadenceDays <= 0) return last;
  if (cadenceDays >= 26 && cadenceDays <= 35) {
    const dom = dayOfMonth(last);
    const d = new Date(last + 'T12:00:00');
    for (let i = 1; i < 36; i++) {
      const first = new Date(d.getFullYear(), d.getMonth() + i, 1);
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const next = iso(new Date(first.getFullYear(), first.getMonth(), Math.min(dom, days)));
      if (next > today) return next;
    }
  }
  let d = last;
  while (d <= today) d = addDays(d, cadenceDays);
  return d;
}

/** Home's "Upcoming": bills paid in the last two days and due in the next
 *  `days`, paychecks left out (they are not something to pay). */
export function upcoming(events: PlanEvent[], now = new Date(), days = 7): PlanEvent[] {
  const today = iso(now);
  const until = addDays(today, days);
  const since = addDays(today, -2);
  return events.filter((e) => e.kind !== 'pay' && (e.paid ? e.date >= since : e.date >= today && e.date <= until));
}

// ---- recurring charges that did not come ----------------------------------

export interface MissedBill {
  id: string;
  name: string;
  emoji: string;
  /** YYYY-MM-DD the charge was expected. */
  expected: string;
  usual: number;
  /** Its past charges. */
  href: string;
}

/**
 * Charges that missed their last expected date ($lib/recurringState): "may
 * have stopped". Still in the forecasts -- late charges are common -- and gone
 * by themselves after a second missed cycle; "It stopped" ends one now.
 */
export async function missedBills(): Promise<MissedBill[]> {
  const [series, cats] = await Promise.all([
    bills(),
    db.select({ id: categories.id, icon: categories.icon }).from(categories)
  ]);
  const icon = new Map(cats.map((c) => [c.id, c.icon]));
  return series
    .filter((s) => s.missed)
    .map((s) => ({
      id: s.id,
      name: s.name,
      emoji: (s.categoryId && icon.get(s.categoryId)) || '🔁',
      expected: s.missed!,
      usual: s.usual,
      href: s.href
    }))
    .sort((a, b) => a.expected.localeCompare(b.expected));
}
