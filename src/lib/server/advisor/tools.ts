import { z } from 'zod';
import { runAsUser } from '../db';
import { budgetsForMonth } from '../budgets';
import { listGoals } from '../goals';
import { listLoans } from '../loans';
import { addMonths, projectPayoff } from '../../loanMath';
import { db } from '../db';
import { categories } from '../db/schema';
import { drillHref } from '../../drill';
import { accountDisplayName } from '../../accountName';
import { addDays, daysInMonth, dayOfMonth, monthsLater } from '../../advisor/days';
import { affordability, lowestPoint } from '../../advisor/forecast';
import { formatFig, type Fig } from '../../advisor/figures';
import { CalcError, evaluate } from '../../advisor/calc';
import { detectPaychecks, type PaySeries } from '../../advisor/paychecks';
import {
  userFloor,
  averageMonth,
  baseline,
  bills,
  investments,
  ledger,
  loanName,
  loanPaymentsMonthly,
  monthTotals,
  monthlyBills,
  monthlyEquivalent,
  outlook,
  position,
  savingsInflow,
  wholeMonths
} from './facts';
import type { Gap } from './facts';

/**
 * The advisor's tools. Every figure the model can mention comes out of one of
 * these, computed by the app from the ledger; the model chooses which to ask,
 * reads the results, and explains them. It never does the arithmetic.
 *
 * Each figure in a result is registered and appears as `"$1,234.56 [f3]"`.
 * The model writes `{{f3}}` in its answer instead of the number, and the page
 * renders the registered figure -- masked if money, linked to its rows if it
 * is a sum of transactions. What the model sees is aggregates: totals,
 * categories, cleaned merchant and account names. Never a transaction list,
 * a raw bank descriptor or an account number.
 *
 * Each call opens its own `runAsUser()` scope: the question is answered by a
 * background job (see agent.ts), outside any request, and a short transaction
 * per tool keeps a pooled connection from idling through a model call.
 */

export class FigureBook {
  private n = 0;
  readonly figures: Record<string, Fig> = {};
  /** Structured results a chart can be drawn from, by shape. */
  readonly payloads: Partial<Record<Shape, unknown>> = {};
  /** What the data cannot show yet, from any tool that ran into it. */
  readonly gaps = new Map<string, Gap>();
  /** The account a forecast followed, for the answer's footnote. */
  basisAccount: string | null = null;
  /** A footnote of its own (investing answers rest on holdings). */
  basisText: string | null = null;
  note(look: { gaps: Gap[]; account: { name: string } | null }) {
    for (const g of look.gaps) this.gaps.set(g.key, g);
    if (look.account) this.basisAccount = look.account.name;
  }

  private add(f: Fig): string {
    const id = `f${++this.n}`;
    this.figures[id] = f;
    return `${formatFig(f)} [${id}]`;
  }
  money(value: number, label: string, href?: string | null, tone?: 'over'): string {
    return this.add({ kind: 'money', value: Math.round(value * 100) / 100, label, href: href ?? null, ...(tone ? { tone } : {}) });
  }
  percent(value: number, label: string): string {
    return this.add({ kind: 'percent', value, label });
  }
  rate(apr: number, label: string): string {
    return this.add({ kind: 'rate', value: apr, label });
  }
  months(value: number, label: string): string {
    return this.add({ kind: 'months', value: Math.round(value * 10) / 10, label });
  }
  count(value: number, label: string): string {
    return this.add({ kind: 'count', value, label });
  }
}

export type { Shape, Gap } from '../../advisor/answer';
import type { Shape } from '../../advisor/answer';

const fmtShort = (days: number) =>
  new Date(Date.now() + days * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const fmtDay = (day: string) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** Shown on the page while it runs. */
  /** The "Working it out" line (7d): [while running, once done]. */
  steps: (input: z.infer<S>) => [string, string];
  run: (input: z.infer<S>, book: FigureBook) => Promise<unknown>;
}

function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

const matchName = (want: string, have: string) => have.toLowerCase().includes(want.trim().toLowerCase());

/**
 * Where flexible spending could realistically come down (7g): each category's
 * monthly average against its envelope or its own lowest recent month, capped
 * at 40% off. Shared by spending_cuts and savings_plan, so "trim the flexible
 * categories" means the same amount in both.
 */
async function flexibleCuts(l: Awaited<ReturnType<typeof ledger>>) {
  const months = wholeMonths(l, 3);
  const envs = await budgetsForMonth(new Date());
  const FIXED = /rent|mortgage|housing|insurance|tax|utilit|loan|interest|fee|child ?care|tuition|medical|health|transfer/i;
  // The biggest single charge per category across those months: a
  // category that is mostly one car repair is not a habit to trim.
  const span = months.length ? { from: months[0].from, to: months[months.length - 1].to } : null;
  const biggest = new Map<string, number>();
  for (const r of l.rows) {
    if (!span || r.amount >= 0 || r.day < span.from || r.day > span.to) continue;
    const k = r.categoryId ?? 'none';
    biggest.set(k, Math.max(biggest.get(k) ?? 0, -r.amount));
  }
  const keys = new Set(months.flatMap((m) => [...m.byCategory.keys()]));
  const rows = [...keys]
    .map((k) => {
      const name = months.map((m) => m.byCategory.get(k)?.name).find(Boolean)!;
      const per = months.map((m) => m.byCategory.get(k)?.spent ?? 0);
      const avg = per.reduce((s, v) => s + v, 0) / per.length;
      const low = Math.min(...per);
      const env = envs.find((e) => e.categoryId === k && e.amount > 0);
      // Back to its envelope, or to a month already managed (7g), whichever
      // is lower -- but never more than 40% off the average: past that it
      // is a different life, not a cut.
      const lowIdx = per.indexOf(low);
      const cat = k === 'none' ? null : k;
      const options = [
        ...(env && env.amount < avg ? [{ v: env.amount, why: 'Its envelope', href: null as string | null }] : []),
        ...(months.length >= 2 && low < avg
          ? [{ v: low, why: `${months[lowIdx].label}'s level`, href: drillHref({ category: cat, from: months[lowIdx].from, to: months[lowIdx].to, flow: 'out' }) }]
          : [])
      ].sort((a, b) => a.v - b.v);
      const pick = options[0] ?? null;
      const aim = pick ? Math.max(pick.v, avg * 0.6) : null;
      const total = per.reduce((s, v) => s + v, 0);
      const lumpy = total > 0 && (biggest.get(k) ?? 0) > total * 0.5;
      const exact = pick !== null && aim === pick.v;
      return {
        k,
        name,
        avg,
        low,
        aim,
        why: exact ? pick!.why : 'Six in ten of usual',
        aimHref: exact ? pick!.href : null,
        lumpy,
        envelope: env?.amount ?? null
      };
    })
    .filter((r) => !FIXED.test(r.name) && !r.lumpy && r.aim !== null && r.avg - r.aim >= 10)
    .sort((a, b) => b.avg - b.aim! - (a.avg - a.aim!));
  return { months, rows };
}

/** Regular paychecks as a monthly amount. */
const PER_MONTH: Record<PaySeries['cadence'], number> = { weekly: 52 / 12, biweekly: 26 / 12, semimonthly: 2, monthly: 1 };
function paychecksMonthly(l: Awaited<ReturnType<typeof ledger>>): number | null {
  const pays = detectPaychecks(
    l.rows
      .filter((r) => r.amount > 0 && r.accountType === 'depository')
      .map((r) => ({ day: r.day, amount: r.amount, key: r.key, name: r.merchant, accountId: r.accountId })),
    l.today
  );
  return pays.length ? pays.reduce((s, p) => s + p.typical * PER_MONTH[p.cadence], 0) : null;
}

export const TOOLS = [
  tool({
    name: 'financial_snapshot',
    description:
      'The household at a glance: checking and savings, card balances, net worth, debts, investments, typical monthly income and spending, bills and loan payments a month, how many months of spending savings covers (the emergency fund), detected paychecks, and notes on what the data cannot show yet. Call this first for any broad question.',
    input: z.object({}),
    steps: () => ['Reading balances and the last three months', 'Read balances and the last three months'],
    run: async (_, book) => {
      const l = await ledger();
      const [pos, look, loans, billRows] = await Promise.all([position(), outlook(l, 30), listLoans(), bills()]);
      book.note(look);
      const base = baseline(l, new Set(billRows.map((b) => `${b.accountId}::${b.key}`)));
      const loanMonthly = loanPaymentsMonthly(loans);
      const month = averageMonth(l, base);
      const left = base.monthlyIncome - base.monthlySpending;
      return {
        as_of: l.today,
        history: { first_day: l.firstDay, days: l.historyDays, averaged_over: `${base.from} to ${base.to} (${base.days} days)` },
        checking: book.money(pos.checking, 'in checking'),
        savings: book.money(pos.savings.balance, pos.savings.name),
        emergency_fund_covers:
          month > 0 ? book.months(Math.max(0, pos.savings.balance / month), `months of spending ${pos.savings.name} covers`) : null,
        average_month_spending: book.money(month, 'an average month of spending'),
        monthly_bills: book.money(monthlyBills(billRows, loans), 'recurring bills and loan payments a month'),
        cash_after_cards: book.money(pos.cash, 'deposits less card balances'),
        deposits: book.money(pos.deposits, 'in deposit accounts'),
        card_balances_owed: book.money(pos.cardOwed, 'owed on cards'),
        loans_owed: book.money(pos.loansOwed, 'owed on loans'),
        investments: book.money(pos.investments, 'investments'),
        net_worth: book.money(pos.netWorth, 'net worth'),
        monthly_income: book.money(base.monthlyIncome, 'typical monthly income', base.incomeHref),
        monthly_spending: book.money(base.monthlySpending, 'typical monthly spending', base.spendingHref),
        monthly_left_over: book.money(left, 'left over in a typical month, before loan payments'),
        monthly_free_after_loans: book.money(left - loanMonthly, 'free to save each month, after loan payments'),
        ...(() => {
          const pay = paychecksMonthly(l);
          return pay !== null ? { regular_paychecks_a_month: book.money(pay, 'regular paychecks a month') } : {};
        })(),
        share_kept: base.monthlyIncome > 0 ? book.percent(left / base.monthlyIncome, 'share of income kept') : null,
        monthly_loan_payments: book.money(loanMonthly, 'loan payments a month (not counted in spending)'),
        paychecks: look.paychecks.map((p) => ({
          from: p.name,
          schedule: p.cadence,
          usual_amount: book.money(p.typical, `usual ${p.name} deposit`),
          last: p.lastDay
        })),
        accounts: pos.accounts.map((a) => ({ name: a.name, type: a.type })),
        notes: look.notes
      };
    }
  }),

  tool({
    name: 'cash_forecast',
    description:
      'The checking account day by day for the coming days: paychecks landing in it, bills and loan payments charged to it, card autopays and transfers to the household\'s other accounts, and everyday debit spending at its recent rate. Returns the lowest point and the dated events. Use for "am I OK until payday", "what is due this month".',
    input: z.object({ days: z.number().int().min(7).max(60).optional().describe('How far ahead, default 30.') }),
    steps: ({ days }) => {
      const until = fmtShort(days ?? 30);
      return [`Looking at bills due before ${until}`, `Looked at bills due before ${until}`];
    },
    run: async ({ days }, book) => {
      const l = await ledger();
      const look = await outlook(l, days ?? 30);
      book.note(look);
      if (!look.account) return { notes: look.notes };
      const low = lowestPoint(look.points);
      const end = look.points[look.points.length - 1];
      return {
        today: l.today,
        account: look.account.name,
        balance_now: book.money(look.start, `${look.account.name} now`),
        everyday_spending_per_day: book.money(look.everydayPerDay, 'everyday debit spending a day'),
        lowest: { day: fmtDay(low.day), balance: book.money(low.balance, `lowest ${look.account.name} in the forecast`) },
        at_end: { day: fmtDay(end.day), balance: book.money(end.balance, `${look.account.name} at the end of the forecast`) },
        events: look.events.map((e) => ({
          day: fmtDay(e.day),
          what: e.label,
          kind: e.kind,
          // A magnitude and a direction: a signed figure reads as "rent of
          // -$1,695.00" once it is in a sentence.
          direction: e.amount >= 0 ? 'in' : 'out',
          amount: book.money(Math.abs(e.amount), `${e.label} on ${fmtDay(e.day)}`, e.href),
          ...(e.estimated ? { estimated: true } : {})
        })),
        notes: look.notes
      };
    }
  }),

  tool({
    name: 'can_afford',
    description:
      'Whether a purchase fits: pays for it from checking on the day asked (today by default) and checks checking stays above the floor through every bill, transfer and paycheck after it. Answers now / wait until a date / not in the next six weeks, with what it runs into, plus what is left in the matching envelope. Use for any "can I buy / afford / should I get" question with an amount.',
    input: z.object({
      amount: z.number().positive().describe('The price in dollars.'),
      what: z.string().max(80).describe('What it is, in a few words, e.g. "new TV".'),
      category: z.string().max(60).optional().describe('The spending category it belongs to, from the category names you know.'),
      on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD, if they named a day.'),
      floor: z.number().min(0).optional().describe('Cash to keep in checking; defaults to the floor set in Settings.')
    }),
    steps: ({ what }) => [`Checking ${what} against bills and paychecks`, `Checked ${what} against bills and paychecks`],
    run: async ({ amount, what, category, on, floor }, book) => {
      const l = await ledger();
      const look = await outlook(l, 60);
      book.note(look);
      if (!look.account) return { notes: look.notes };
      const keep = floor ?? (await userFloor());
      const a = affordability(look.points, look.events, amount, keep, on);

      let envelope: Record<string, unknown> | null = null;
      if (category) {
        const rows = await budgetsForMonth(new Date());
        const env = rows.find((r) => r.name.toLowerCase() === category.toLowerCase()) ?? rows.find((r) => matchName(category, r.name));
        if (env && env.amount > 0) {
          const monthFrom = monthsLater(l.today, 0);
          const href = drillHref({ category: env.categoryId, from: monthFrom, to: addDays(monthsLater(l.today, 1), -1), flow: 'out' });
          // Over is said as over, never as a negative amount left.
          const state = (left: number, after: string) =>
            left >= 0
              ? { left: book.money(left, `left in ${env.name}${after}`) }
              : { over_by: book.money(-left, `over the ${env.name} envelope${after}`, href, 'over') };
          const left = env.amount - env.spent;
          envelope = {
            category: env.name,
            limit: book.money(env.amount, `${env.name} envelope`),
            spent: book.money(env.spent, `spent on ${env.name} this month`, href),
            now: state(left, ''),
            after_buying: state(left - amount, ` after ${what}`)
          };
        } else if (env) {
          envelope = { category: env.name, note: 'No envelope set for this category.' };
        }
      }

      const payload = {
        verdict: a.verdict,
        amount: a.amount,
        floor: a.floor,
        asked: a.asked,
        buyDay: a.buyDay,
        unlockedBy: a.unlockedBy,
        lowest: a.lowest,
        what,
        account: look.account.name,
        // The forecast without the purchase, dashed on the chart.
        without: look.points,
        // The forecast *with* the purchase, for the chart.
        points: look.points.map((p) => ({
          day: p.day,
          balance: Math.round((p.balance - (p.day >= (a.buyDay ?? a.asked) ? amount : 0)) * 100) / 100
        })),
        events: look.events.filter((e) => e.day <= addDays(l.today, 45))
      };
      book.payloads.afford = payload;

      return {
        verdict: a.verdict === 'now' ? 'fits now' : a.verdict === 'wait' ? 'fits later' : 'does not fit in the next six weeks',
        paid_from: look.account.name,
        price: book.money(amount, what),
        floor: book.money(keep, 'floor'),
        buy_on: a.buyDay ? fmtDay(a.buyDay) : null,
        made_possible_by: a.unlockedBy
          ? { what: a.unlockedBy.label, day: fmtDay(a.unlockedBy.day), amount: book.money(a.unlockedBy.amount, a.unlockedBy.label, a.unlockedBy.href) }
          : null,
        lowest_after_buying: { day: fmtDay(a.lowest.day), balance: book.money(a.lowest.balance, `lowest ${look.account.name} after ${what}`) },
        ...(a.cushion >= 0
          ? { room_above_floor: book.money(a.cushion, 'room above the floor') }
          : { short_of_floor_by: book.money(-a.cushion, 'short of the floor') }),
        big_bills_before_then: a.dueBefore.map((e) => ({ what: e.label, day: fmtDay(e.day), amount: book.money(-e.amount, e.label, e.href) })),
        envelope,
        notes: look.notes
      };
    }
  }),

  tool({
    name: 'spending_by_category',
    description:
      'Spending per category: this month so far, each of the last three whole months, the average, and the envelope limit. Use for "where does my money go", "am I spending more", comparisons between months.',
    input: z.object({}),
    steps: () => ['Adding up spending by category', 'Added up spending by category'],
    run: async (_, book) => {
      const l = await ledger();
      const months = wholeMonths(l, 3);
      const now = monthTotals(l, monthsLater(l.today, 0), l.today);
      const envs = new Map((await budgetsForMonth(new Date())).map((b) => [b.categoryId, b.amount]));
      const keys = new Set<string>([...now.byCategory.keys(), ...months.flatMap((m) => [...m.byCategory.keys()])]);
      const rows = [...keys].map((k) => {
        const name = now.byCategory.get(k)?.name ?? months.map((m) => m.byCategory.get(k)?.name).find(Boolean) ?? k;
        const id = k === 'none' ? null : k;
        const per = months.map((m) => m.byCategory.get(k)?.spent ?? 0);
        const avg = per.length ? per.reduce((s, v) => s + v, 0) / per.length : null;
        return { k, id, name, per, avg, now: now.byCategory.get(k)?.spent ?? 0 };
      });
      rows.sort((a, b) => (b.avg ?? b.now) - (a.avg ?? a.now));
      return {
        this_month_through: l.today,
        day_of_month: `${dayOfMonth(l.today)} of ${daysInMonth(l.today)}`,
        whole_months: months.map((m) => m.label),
        total_this_month: book.money(now.spending, 'spent this month', drillHref({ from: now.from, to: now.to, flow: 'out' })),
        totals_by_month: months.map((m) => ({ month: m.label, spent: book.money(m.spending, `spent in ${m.label}`, drillHref({ from: m.from, to: m.to, flow: 'out' })) })),
        categories: rows.slice(0, 20).map((r) => ({
          category: r.name,
          this_month: book.money(r.now, `${r.name} this month`, drillHref({ category: r.id, from: now.from, to: now.to, flow: 'out' })),
          by_month: months.map((m, i) => book.money(r.per[i], `${r.name} in ${m.label}`, drillHref({ category: r.id, from: m.from, to: m.to, flow: 'out' }))),
          average: r.avg === null ? null : book.money(r.avg, `${r.name} a month on average`),
          envelope: r.id && envs.get(r.id) ? book.money(envs.get(r.id)!, `${r.name} envelope`) : null
        })),
        notes: months.length < 3 ? [`History covers ${months.length} whole month(s).`] : []
      };
    }
  }),

  tool({
    name: 'category_detail',
    description:
      'One category over the last 90 days: total, monthly average, and the merchants that make it up. Use to dig into a category before suggesting where to cut.',
    input: z.object({ category: z.string().max(60) }),
    steps: ({ category }) => [`Looking into ${category}`, `Looked into ${category}`],
    run: async ({ category }, book) => {
      const l = await ledger();
      const { from, to, days } = l.window;
      const rows = l.rows.filter((r) => r.amount < 0 && r.day >= from && r.day <= to);
      const names = [...new Set(rows.map((r) => r.category))];
      const name = names.find((n) => n.toLowerCase() === category.toLowerCase()) ?? names.find((n) => matchName(category, n));
      if (!name) return { error: `No spending in a category called "${category}" in the last ${days} days.`, categories: names };
      const mine = rows.filter((r) => r.category === name);
      const id = mine[0].categoryId;
      const total = mine.reduce((s, r) => s - r.amount, 0);
      const byMerchant = new Map<string, { name: string; total: number; count: number }>();
      for (const r of mine) {
        const m = byMerchant.get(r.key) ?? { name: r.merchant, total: 0, count: 0 };
        m.total -= r.amount;
        m.count++;
        byMerchant.set(r.key, m);
      }
      return {
        category: name,
        window: `${from} to ${to} (${days} days)`,
        total: book.money(total, `${name} over ${days} days`, drillHref({ category: id, from, to, flow: 'out' })),
        per_month: book.money((total / days) * 30.44, `${name} a month`),
        merchants: [...byMerchant.entries()]
          .sort((a, b) => b[1].total - a[1].total)
          .slice(0, 12)
          .map(([key, m]) => ({
            merchant: m.name,
            visits: m.count,
            total: book.money(m.total, `${m.name} over ${days} days`, drillHref({ merchant: key, from, to, flow: 'out' }))
          }))
      };
    }
  }),

  tool({
    name: 'subscriptions',
    description:
      'Recurring charges found in the ledger (subscriptions, utilities, insurance), each with its usual amount, monthly cost, and whether the price changed. Loan payments are listed separately as fixed bills.',
    input: z.object({}),
    steps: () => ['Listing recurring charges', 'Listed recurring charges'],
    run: async (_, book) => {
      const [billRows, loans] = await Promise.all([bills(), listLoans()]);
      const monthly = billRows.reduce((s, b) => s + monthlyEquivalent(b.amount, b.cadenceDays), 0);
      return {
        monthly_total: book.money(monthly, 'recurring charges a month'),
        charges: billRows
          .sort((a, b) => monthlyEquivalent(b.amount, b.cadenceDays) - monthlyEquivalent(a.amount, a.cadenceDays))
          .map((b) => ({
            name: b.name,
            every: b.cadenceDays === 30 ? 'month' : `${b.cadenceDays} days`,
            amount: book.money(b.amount, b.name, b.href),
            per_month: book.money(monthlyEquivalent(b.amount, b.cadenceDays), `${b.name} a month`),
            ...(b.changed ? { was: book.money(b.usual, `${b.name} before`) } : {}),
            ...(b.suspected ? { seen_once: true } : {})
          })),
        loan_payments: loans
          .filter((x) => x.owed >= 0.01 && x.payment)
          .map((x) => ({ loan: loanName(x), payment: book.money(x.payment!, `${loanName(x)} payment`), next_due: x.nextDue }))
      };
    }
  }),

  tool({
    name: 'debt_payoff',
    description:
      'Each loan: what is owed, the payment, the rate (entered or estimated), and the payoff date and interest left -- as things stand and with an extra amount a month. Also card balances. Use for payoff, refinance and "pay down debt or invest" questions.',
    input: z.object({
      extra_per_month: z.number().min(0).max(100000).optional().describe('Extra paid toward each loan every month.'),
      loan: z.string().max(60).optional().describe('Only this loan, by name.')
    }),
    steps: ({ extra_per_month }) =>
      extra_per_month
        ? ['Working out the payoff with the extra payment', 'Worked out the payoff with the extra payment']
        : ['Reading the loans', 'Read the loans'],
    run: async ({ extra_per_month, loan }, book) => {
      const [loans, pos] = await Promise.all([listLoans(), position()]);
      const extra = extra_per_month ?? 0;
      const chosen = loans.filter((x) => x.owed >= 0.01 && (!loan || matchName(loan, loanName(x))));
      const out = chosen.map((x) => {
        const name = loanName(x);
        const base = {
          loan: name,
          owed: book.money(x.owed, `owed on ${name}`),
          payment: x.payment ? book.money(x.payment, `${name} payment`) : null,
          rate: x.rate ? { apr: book.rate(x.rate.apr, `${name} rate`), source: x.rate.source } : 'not known',
          next_due: x.nextDue
        };
        if (!x.payment) return { ...base, note: 'No payment seen yet.' };
        if (!x.rate) {
          return {
            ...base,
            note: 'Rate unknown: the payoff below assumes 0% interest, so it is the earliest possible date. Entering the rate on the Loans page makes it exact.',
            payments_left_at_zero: Math.ceil(x.owed / x.payment),
            ...(extra ? { payments_left_at_zero_with_extra: Math.ceil(x.owed / (x.payment + extra)) } : {})
          };
        }
        const now = projectPayoff(x.owed, x.payment, x.rate.apr);
        const faster = extra ? projectPayoff(x.owed, x.payment + extra, x.rate.apr) : null;
        return {
          ...base,
          as_is: now ? { payments_left: now.payments, interest_left: book.money(now.interest, `interest left on ${name}`) } : 'payment does not cover the interest',
          ...(faster && now
            ? {
                with_extra: {
                  extra: book.money(extra, 'extra a month'),
                  payments_left: faster.payments,
                  months_sooner: now.payments - faster.payments,
                  interest_left: book.money(faster.interest, `interest left on ${name} with the extra`),
                  interest_saved: book.money(now.interest - faster.interest, `interest saved on ${name}`)
                }
              }
            : {})
        };
      });
      // 7e: as it is, and with the extra, for the first loan the question is
      // about. Payment N lands N-1 months after the next one due.
      const monthOf = (nextDue: string | null, n: number) =>
        nextDue ? addMonths(new Date(nextDue + 'T12:00:00Z'), Math.max(0, n - 1)).toISOString().slice(0, 10) : null;
      const first = chosen.find((x) => x.payment && x.rate);
      if (first && first.payment && first.rate) {
        const now = projectPayoff(first.owed, first.payment, first.rate.apr);
        const faster = projectPayoff(first.owed, first.payment + extra, first.rate.apr);
        if (now && faster) {
          book.payloads.debt = {
            loan: loanName(first),
            owed: first.owed,
            rate: first.rate,
            nextDue: first.nextDue,
            extra,
            asIs: { payment: first.payment, payments: now.payments, interest: now.interest, paidOff: monthOf(first.nextDue, now.payments) },
            withExtra: extra
              ? { payment: first.payment + extra, payments: faster.payments, interest: faster.interest, paidOff: monthOf(first.nextDue, faster.payments) }
              : null
          };
        }
      }
      return {
        loans: out,
        paid_off: loans.filter((x) => x.paidOff).map(loanName),
        cards_owed: book.money(pos.cardOwed, 'owed on cards'),
        note: 'Card interest rates are not known to the app.'
      };
    }
  }),

  tool({
    name: 'goal_projection',
    description:
      'Savings and payoff goals: target, progress, what the target date needs a month, the pace so far, and when it finishes at that pace -- optionally with an extra amount a month.',
    input: z.object({
      goal: z.string().max(60).optional(),
      extra_per_month: z.number().min(0).max(100000).optional()
    }),
    steps: () => ['Checking goals', 'Checked goals'],
    run: async ({ goal, extra_per_month }, book) => {
      const goals = (await listGoals()).filter((g) => g.status === 'active' && (!goal || matchName(goal, g.name)));
      const extra = extra_per_month ?? 0;
      // 7f draws the first goal as the 2b card: the bar, the pace marker
      // (where it should be today), and done-dates at the pace and as needed.
      const g0 = goals[0];
      if (g0) {
        const pace = (g0.pacePerMonth ?? 0) + extra;
        const done = pace > 0 ? new Date(Date.now() + (g0.remaining / pace) * 30.44 * 86400000) : null;
        let expected: number | null = null;
        if (g0.targetDate) {
          const span = g0.targetDate.getTime() - g0.createdAt.getTime();
          expected = span > 0 ? Math.min(1, Math.max(0, (Date.now() - g0.createdAt.getTime()) / span)) : null;
        }
        book.payloads.goal = {
          name: g0.name,
          account: g0.accountName ? accountDisplayName({ name: g0.accountName, nickname: null, orgName: null }) : null,
          target: g0.target,
          current: g0.current,
          progress: g0.progress,
          expected,
          targetDate: g0.targetDate?.toISOString().slice(0, 10) ?? null,
          daysLeft: g0.daysLeft,
          onTrack: g0.onTrack,
          extra,
          pace: g0.pacePerMonth === null ? null : pace,
          doneAtPace: done ? done.toISOString().slice(0, 10) : null,
          needed: g0.requiredPerMonth
        };
      }
      if (!goals.length) return { goals: [], note: goal ? `No active goal matching "${goal}".` : 'No active goals.' };
      return {
        goals: goals.map((g) => {
          const pace = (g.pacePerMonth ?? 0) + extra;
          const monthsToGo = pace > 0 ? g.remaining / pace : null;
          return {
            goal: g.name,
            kind: g.direction,
            target: book.money(g.target, `${g.name} target`),
            now: book.money(g.current, `${g.name} now`),
            progress: book.percent(g.progress, `${g.name} progress`),
            remaining: book.money(g.remaining, `left to go on ${g.name}`),
            target_date: g.targetDate?.toISOString().slice(0, 10) ?? null,
            needs_per_month: g.requiredPerMonth ? book.money(g.requiredPerMonth, `${g.name} needs a month`) : null,
            pace_per_month: g.pacePerMonth !== null ? book.money(g.pacePerMonth, `${g.name} pace a month`) : 'not enough history yet',
            on_track: g.onTrack,
            ...(extra ? { with_extra: book.money(extra, 'extra a month') } : {}),
            finishes_in: monthsToGo !== null ? book.months(monthsToGo, `until ${g.name} is done`) : null
          };
        })
      };
    }
  }),

  tool({
    name: 'investments',
    description:
      'Investment accounts: total, the mix by asset class (US stocks, international, bonds, target-date funds, cash), gain on cost where the provider reports a purchase price, and money put in over the last 90 days.',
    input: z.object({}),
    steps: () => ['Reading investment accounts', 'Read investment accounts'],
    run: async (_, book) => {
      const inv = await investments();
      if (!inv) return { note: 'No investment accounts connected.' };
      book.basisText = `Worked out from ${inv.accounts.map((a) => a.name).join(', ')} holdings`;
      return {
        total: book.money(inv.worth, 'invested'),
        accounts: inv.accounts.map((a) => ({ name: a.name, balance: book.money(a.balance, a.name) })),
        holdings_as_of: inv.asOf,
        mix: inv.mix.map((m) => ({ asset_class: m.label, value: book.money(m.value, m.label), share: book.percent(m.share, `${m.label} share`) })),
        gain_on_cost: inv.costKnown
          ? {
              value: book.money(inv.costKnown.value, 'value of positions with a known cost'),
              cost: book.money(inv.costKnown.cost, 'what they cost'),
              gain: book.money(inv.costKnown.value - inv.costKnown.cost, 'gain on cost'),
              note: 'Only positions that report a purchase price (some 401(k) plans report none).'
            }
          : null,
        put_in_last_90_days: book.money(inv.putIn90, 'put in over 90 days'),
        note: 'Balances move with the market; history of daily balances began recently.'
      };
    }
  }),

  tool({
    name: 'savings_plan',
    description:
      'Projects ANY savings target the household names -- no goal has to exist in the app. Takes a dollar target ("$30K in savings") or a number of months of expenses ("six months of expenses"), optionally a deadline and/or a monthly amount to try. Returns where they start (savings accounts today), the gap, what is free to save each month (income less spending less loan payments, over the last three months), what has actually been landing in savings, and when they reach the target at each pace: everything free each month, that plus realistic cuts to flexible spending, the amount they named, and the actual savings trend. With a deadline: what it needs a month and whether that fits. Use for "how long until I have", "how much a month to reach", "what if I saved X a month", emergency-fund sizes.',
    input: z.object({
      target_amount: z.number().positive().optional().describe('The target in dollars, if they named one.'),
      months_of_expenses: z.number().positive().max(36).optional().describe('A target sized as N months of average spending ("six months of expenses").'),
      by_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD, if they named a deadline.'),
      monthly_amount: z.number().positive().optional().describe('A monthly amount they want to try ("if I put $1,000 a month in").'),
      starting_from: z
        .enum(['savings', 'all_cash', 'zero'])
        .optional()
        .describe('What counts toward it: savings accounts (default), every deposit account, or a fresh fund from zero.'),
      what: z.string().max(60).optional().describe('A short name for the target, e.g. "$30K in savings".')
    }),
    steps: () => ['Projecting the savings target', 'Projected the savings target'],
    run: async ({ target_amount, months_of_expenses, by_date, monthly_amount, starting_from, what }, book) => {
      if (!target_amount && !months_of_expenses) return { error: 'Give target_amount or months_of_expenses.' };
      const l = await ledger();
      const [pos, loans, billRows, inflow] = await Promise.all([position(), listLoans(), bills(), savingsInflow(90)]);
      const base = baseline(l, new Set(billRows.map((b) => `${b.accountId}::${b.key}`)));
      const month = averageMonth(l, base);
      const loanMonthly = loanPaymentsMonthly(loans);
      const { months: whole, rows: cutRows } = await flexibleCuts(l);
      const room = cutRows.reduce((s, r) => s + (r.avg - r.aim!), 0);

      const target = target_amount ?? (months_of_expenses ?? 0) * month;
      const label =
        what ?? (target_amount ? `${formatFig({ kind: 'money', value: target })} saved` : `${months_of_expenses} months of expenses`);
      const from = starting_from ?? 'savings';
      const start = from === 'zero' ? 0 : from === 'all_cash' ? pos.deposits : pos.savings.balance;
      const startName = from === 'zero' ? 'a fresh fund' : from === 'all_cash' ? 'all deposit accounts' : pos.savings.name;
      const gap = Math.max(0, target - start);
      // What can go toward it: loan payments are transfers, so they are not in
      // spending -- leaving them in would promise money the car already takes.
      const free = base.monthlyIncome - base.monthlySpending - loanMonthly;
      // Income is every deposit; a one-off (a mobile deposit, a refund, a
      // family transfer) inflates it. When regular paychecks are clearly less
      // than income, the paychecks-only figure is the honest floor.
      const payMonthly = paychecksMonthly(l);
      const irregular = payMonthly !== null && base.monthlyIncome - payMonthly > base.monthlyIncome * 0.15;
      const freeFromPay = irregular ? payMonthly! - base.monthlySpending - loanMonthly : null;

      const monthName = (n: number) =>
        new Date(Date.now() + n * 30.44 * 86400000).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const pace = (name: string, perMonth: number) =>
        perMonth > 0
          ? {
              pace: name,
              per_month: book.money(perMonth, `${name} a month`),
              months: book.months(gap / perMonth, `months to ${label} at ${name}`),
              reaches_it: gap > 0 ? `around ${monthName(gap / perMonth)}` : 'already there'
            }
          : { pace: name, per_month: book.money(perMonth, `${name} a month`), reaches_it: 'never at this pace' };

      const paces = [
        pace('everything free each month', free),
        ...(freeFromPay !== null ? [pace('what regular paychecks alone leave free', freeFromPay)] : []),
        ...(room >= 10 ? [pace('free money plus realistic cuts', free + room)] : []),
        ...(monthly_amount ? [pace('the amount named', monthly_amount)] : []),
        ...(inflow && inflow.perMonth > 0 ? [pace('what has actually been landing in savings', inflow.perMonth)] : [])
      ];

      let deadline: Record<string, unknown> | null = null;
      let needed: number | null = null;
      if (by_date) {
        const monthsLeft = (new Date(by_date + 'T12:00:00').getTime() - Date.now()) / (30.44 * 86400000);
        if (monthsLeft <= 0) deadline = { note: 'That date has already passed.' };
        else {
          needed = gap / monthsLeft;
          deadline = {
            by: new Date(by_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
            months_left: book.months(monthsLeft, `months until ${by_date}`),
            needs_per_month: book.money(needed, `needed a month to reach ${label} by then`),
            ...(free > 0 ? { share_of_free_money: book.percent(needed / free, 'share of what is free each month') } : {}),
            fits_in_free_money: free > 0 && needed <= free,
            fits_with_cuts: free + room > 0 && needed <= free + room
          };
        }
      }

      // The pace the chart draws and the answer leads with: the amount they
      // named, else the better of what is free each month and what is
      // actually reaching savings (whichever shows what this household can
      // do), else free plus cuts.
      // With income leaning on irregular deposits, the paychecks-only figure
      // stands in for "free": a projection should not count on a one-off.
      const freeLead = freeFromPay ?? free;
      const best = Math.max(freeLead, inflow?.perMonth ?? 0);
      const lead = monthly_amount
        ? { name: 'the amount named', v: monthly_amount }
        : best > 0
          ? {
              name:
                best === inflow?.perMonth
                  ? 'what has actually been landing in savings'
                  : freeFromPay !== null
                    ? 'what regular paychecks alone leave free'
                    : 'everything free each month',
              v: best
            }
          : free + room > 0
            ? { name: 'free money plus realistic cuts', v: free + room }
            : null;
      const chartPace = lead?.v ?? null;
      book.payloads.goal = {
        name: label.charAt(0).toUpperCase() + label.slice(1),
        account: from === 'savings' ? pos.savings.name : null,
        target: Math.round(target * 100) / 100,
        current: Math.round(start * 100) / 100,
        progress: target > 0 ? Math.min(1, start / target) : 0,
        expected: null,
        targetDate: by_date ?? null,
        daysLeft: by_date ? Math.round((new Date(by_date + 'T12:00:00').getTime() - Date.now()) / 86400000) : null,
        onTrack: needed !== null && chartPace !== null ? chartPace >= needed : null,
        extra: 0,
        pace: chartPace,
        doneAtPace:
          chartPace && chartPace > 0 ? new Date(Date.now() + (gap / chartPace) * 30.44 * 86400000).toISOString().slice(0, 10) : null,
        needed
      };

      const notes: string[] = [];
      if (whole.length < 3) notes.push(`Averages rest on ${whole.length} whole month(s) of history; they will firm up.`);
      if (free <= 0) notes.push('On average, spending plus loan payments use up all income; only cuts or a named amount move this.');
      if (freeFromPay !== null)
        notes.push(
          `Income includes deposits that are not regular paychecks (about ${book.money(base.monthlyIncome - payMonthly!, 'deposits a month that are not regular paychecks')} a month: mobile deposits, refunds, one-offs). If those do not repeat, regular paychecks alone leave ${book.money(freeFromPay, 'free a month from paychecks alone')} a month after spending and loans. Say this; do not lead with the higher figure as if it were certain.`
        );
      if (inflow && free > 0 && inflow.perMonth < free * 0.5)
        notes.push('Much less has been reaching savings than is free each month: the rest stays in checking or goes to cards.');
      notes.push('No interest is assumed on savings; a high-yield account would get there a little sooner.');

      return {
        target: book.money(target, label),
        ...(months_of_expenses
          ? { sized_from: { months: months_of_expenses, average_month: book.money(month, 'an average month of spending') } }
          : {}),
        starting_from: { what: startName, balance: book.money(start, startName) },
        ...(gap > 0 ? { still_to_go: book.money(gap, `left to reach ${label}`) } : { already_there: true }),
        free_each_month: {
          total: book.money(free, 'free to save each month'),
          income: book.money(base.monthlyIncome, 'typical monthly income', base.incomeHref),
          spending: book.money(base.monthlySpending, 'typical monthly spending', base.spendingHref),
          loan_payments: book.money(loanMonthly, 'loan payments a month'),
          ...(payMonthly !== null ? { regular_paychecks: book.money(payMonthly, 'regular paychecks a month') } : {}),
          ...(freeFromPay !== null ? { from_paychecks_alone: book.money(freeFromPay, 'free a month from paychecks alone') } : {})
        },
        realistic_cuts_per_month: room >= 10 ? book.money(room, 'room across flexible categories a month') : null,
        actually_into_savings_per_month: inflow ? book.money(inflow.perMonth, `what has reached ${pos.savings.name} a month lately`) : null,
        lead_with: lead ? `${lead.name} (the chart shows this pace)` : 'no pace reaches it without a named monthly amount',
        paces,
        deadline,
        based_on: whole.length ? whole.map((m) => m.label) : `${base.days} days of history`,
        notes
      };
    }
  }),

  tool({
    name: 'calculate',
    description:
      'Exact arithmetic over figures already in the tool results, for anything the other tools do not answer directly. Write an expression with figure ids and plain numbers, e.g. "f3 / f14" (months to close a gap at a monthly pace) or "(f2 - f5) * 12". Supports + - * / and parentheses. Money figures are dollars, percentages are fractions (0.14), months are months. The result comes back as a new figure to cite. Use it rather than ever saying a number cannot be worked out.',
    input: z.object({
      expression: z.string().min(1).max(200),
      result_kind: z.enum(['money', 'months', 'percent', 'count']).describe('What the result is.'),
      label: z.string().min(1).max(80).describe('What the result means, in words, e.g. "months to reach $30K".')
    }),
    steps: ({ label }) => [`Working out ${label}`, `Worked out ${label}`],
    run: async ({ expression, result_kind, label }, book) => {
      try {
        const v = evaluate(expression, (id) => {
          const f = book.figures[id];
          if (!f || f.kind === 'date') return null;
          const n = Number(f.value);
          return Number.isFinite(n) ? n : null;
        });
        const fig =
          result_kind === 'money'
            ? book.money(v, label)
            : result_kind === 'months'
              ? book.months(v, label)
              : result_kind === 'percent'
                ? book.percent(v, label)
                : book.count(Math.round(v), label);
        return { result: fig };
      } catch (e) {
        return { error: e instanceof CalcError ? e.message : 'Could not evaluate that expression.' };
      }
    }
  }),

  tool({
    name: 'spending_cuts',
    description:
      'Where spending could realistically come down: for each flexible category, its monthly average against its own lowest recent month (what has already been done once) or its envelope, capped at 40% off, and the recurring charges. Fixed costs (housing, insurance, taxes, loans) and categories that are mostly one big purchase are left out. Use for "where can I cut", "how do I save more".',
    input: z.object({ target_per_month: z.number().positive().optional().describe('The saving they want, if they said one.') }),
    steps: () => ['Looking for room in flexible spending', 'Looked for room in flexible spending'],
    run: async ({ target_per_month }, book) => {
      const l = await ledger();
      const { months, rows } = await flexibleCuts(l);
      const subs = await bills();
      const subsMonthly = subs.reduce((s, b) => s + monthlyEquivalent(b.amount, b.cadenceDays), 0);
      const total = rows.reduce((s, r) => s + (r.avg - r.aim!), 0);
      // "The top three together": as many rows as it takes to reach the
      // target, or three when none was named.
      let topN = Math.min(3, rows.length);
      if (target_per_month) {
        let sum = 0;
        topN = rows.findIndex((r) => (sum += r.avg - r.aim!) >= target_per_month) + 1 || rows.length;
      }
      const icons = new Map((await db.select({ id: categories.id, icon: categories.icon }).from(categories)).map((c) => [c.id, c.icon]));
      const range = months.length ? { from: months[0].from, to: months[months.length - 1].to } : null;
      book.payloads.cut = {
        target: target_per_month ?? null,
        months: months.map((m) => m.label.slice(0, 3)),
        topN,
        rows: rows.slice(0, Math.max(topN, Math.min(4, rows.length))).map((r) => ({
          name: r.name,
          icon: r.k === 'none' ? null : (icons.get(r.k) ?? null),
          usual: r.avg,
          usualHref: range ? drillHref({ category: r.k === 'none' ? null : r.k, ...range, flow: 'out' }) : null,
          aim: r.aim,
          aimHref: r.aimHref,
          why: r.why,
          frees: r.avg - r.aim!
        }))
      };
      return {
        based_on: months.length ? months.map((m) => m.label) : 'fewer than one whole month of history',
        ...(target_per_month ? { target: book.money(target_per_month, 'saving wanted a month') } : {}),
        candidates: rows.slice(0, 6).map((r) => ({
          category: r.name,
          average: book.money(r.avg, `${r.name} a month on average`),
          lowest_recent_month: months.length >= 2 ? book.money(r.low, `${r.name} in its lowest month`) : null,
          envelope: r.envelope ? book.money(r.envelope, `${r.name} envelope`) : null,
          room: book.money(r.avg - r.aim!, `room in ${r.name} a month`),
          suggested_budget: book.money(r.aim!, `${r.name} budget to set`)
        })),
        all_candidates_together: book.money(total, 'room across flexible categories a month'),
        recurring_bills_monthly: book.money(subsMonthly, 'recurring bills a month, rent and insurance included'),
        notes: months.length < 2 ? ['Fewer than two whole months of history: compared against envelopes instead of past months.'] : []
      };
    }
  })
];

export type AdvisorTool = (typeof TOOLS)[number];

export function findTool(name: string): ToolDef<z.ZodType> | undefined {
  return TOOLS.find((t) => t.name === name) as ToolDef<z.ZodType> | undefined;
}

/** Runs a tool as `userId`, validating the model's input first. */
export async function runTool(
  userId: string,
  name: string,
  rawInput: unknown,
  book: FigureBook
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const t = findTool(name);
  if (!t) return { ok: false, error: `No tool called ${name}.` };
  const parsed = t.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.message}` };
  try {
    const result = await runAsUser(userId, () => t.run(parsed.data, book));
    return { ok: true, result };
  } catch (e) {
    console.error(`[advisor] tool ${name} failed`, e);
    return { ok: false, error: 'That calculation failed on the server.' };
  }
}

/** The running and done labels for a tool call, for the thinking card. */
export function stepLabels(name: string, rawInput: unknown): [string, string] {
  const t = findTool(name);
  const parsed = t?.input.safeParse(rawInput ?? {});
  return t && parsed?.success ? t.steps(parsed.data) : ['Working it out', 'Worked it out'];
}
