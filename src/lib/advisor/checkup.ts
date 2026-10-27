import type { Fig } from './figures';

/**
 * The Advisor's checkup (handoff 7a, 7k, 7l): what the app noticed on its own,
 * with no model involved and nothing sent anywhere. Pure rules over figures
 * the server has already worked out, so `npm run test:advisor` pins every
 * threshold.
 *
 * A finding is a headline and a context line, each with `{{placeholders}}`
 * filled from `figures` (see `figures.ts`), a severity, an emoji, and a link to
 * where it can be dealt with. Its `key` names the situation *and its figure*:
 * dismissing hides it "until its figure changes", so a new price, a new
 * month or a different shortfall is a new key and the finding comes back.
 */

export type Severity = 'action' | 'look' | 'good';

export interface Finding {
  key: string;
  severity: Severity;
  emoji: string;
  /** The headline, with `{{placeholders}}` for its figures. */
  text: string;
  /** The muted line under it, placeholders allowed. */
  context: string | null;
  figures: Record<string, Fig>;
  /** "Goals ›", "Ask about it ›". An `ask` link opens Ask with the question in the box. */
  link: { label: string; href: string } | null;
  /** For the Undo line: "Hidden: Netflix went up." */
  short: string;
  /** "It comes back if the price changes again." */
  returns: string;
}

export interface EnvelopeFact {
  categoryId: string;
  name: string;
  emoji: string | null;
  limit: number;
  spent: number;
  href: string;
}

export interface CheckupInput {
  today: string;
  /** Days of ledger history the figures rest on. */
  historyDays: number;
  /** Savings accounts, or every deposit account when none is called savings. */
  savings: { balance: number; name: string };
  /** Checking: deposit accounts that are not savings. */
  checking: number;
  /** A typical month's spending: the whole-month average. */
  averageMonth: number;
  /** Recurring bills plus loan payments, per month. */
  monthlyBills: number;
  floor: number;
  /** Lowest point of the next 30 days in checking. */
  low: { day: string; balance: number; before: string | null } | null;
  envelopes: EnvelopeFact[];
  daysLeftInMonth: number;
  /** The first of next month, YYYY-MM-DD, when envelopes reset. */
  resetDay: string;
  priceChanges: Array<{
    id: string;
    name: string;
    emoji: string | null;
    from: number;
    to: number;
    /** The charge that changed. */
    day: string;
    cadenceDays: number;
    href: string;
  }>;
  /** The last whole months (up to three), and the three before them. */
  kept: {
    months: number;
    income: number;
    spending: number;
    href: string;
    before: { income: number; spending: number } | null;
    /** A month in the window with three paychecks, e.g. "July". */
    threePaychecks: string | null;
  } | null;
  /** This month so far against a typical month, from day 10 on. */
  pace: { spent: number; projected: number; typical: number; day: number; days: number; href: string } | null;
  goalsBehind: Array<{ id: string; name: string; needed: number; pace: number }>;
}

/** Below three months of spending, savings is short of the usual cushion. */
export const CUSHION_MONTHS = { short: 3, plenty: 6 };
/** Checking this far over two months of bills is worth a look. */
const IDLE_MIN = 500;
/** Spending pace: this far above a typical month, and by at least this much. */
const PACE_RATIO = 1.2;
const PACE_MIN = 200;
/** Keeping this share of income is worth saying so. */
const GOOD_RATE = 0.2;
/** Before this, a month's pace is mostly noise. */
export const PACE_FROM_DAY = 10;

const RANK: Record<Severity, number> = { action: 0, look: 1, good: 2 };

const ask = (question: string) => `/advisor?q=${encodeURIComponent(question)}`;

const shortDay = (day: string) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const cents = (v: number) => Math.round(v * 100);

export function checkup(i: CheckupInput): Finding[] {
  const out: Finding[] = [];
  const money = (value: number, href?: string | null, label?: string): Fig => ({
    kind: 'money',
    value: Math.round(value * 100) / 100,
    href: href ?? null,
    label
  });
  const cushion = i.averageMonth > 0 ? i.savings.balance / i.averageMonth : null;
  const enoughHistory = i.historyDays >= 28;

  // Cash dipping under the floor soon outranks everything: it has a date.
  if (i.low && i.low.balance < i.floor) {
    out.push({
      key: `dip:${i.low.day}:${cents(i.low.balance)}`,
      severity: 'action',
      emoji: '📅',
      text: 'Checking dips to {{low}} on {{day}}, under your {{floor}} floor',
      context: i.low.before ? `After ${i.low.before} goes out` : null,
      figures: { low: money(i.low.balance), day: { kind: 'date', value: i.low.day }, floor: money(i.floor) },
      link: { label: 'Ask about it ›', href: ask('Will checking have enough before my next paycheck?') },
      short: 'Checking dips under the floor',
      returns: 'It comes back if the forecast changes.'
    });
  }

  if (enoughHistory && cushion !== null && cushion < CUSHION_MONTHS.short) {
    out.push({
      key: `cushion:${cushion.toFixed(1)}`,
      severity: 'action',
      emoji: '🛟',
      text: 'Emergency fund covers {{months}} of spending',
      context: `Target is 3–6 months · ${i.savings.name} against an average month`,
      figures: { months: { kind: 'months', value: Math.max(0, cushion), label: 'emergency fund' } },
      link: { label: 'Goals ›', href: '/plan?tab=goals' },
      short: 'Emergency fund is short',
      returns: 'It comes back when the months it covers change.'
    });
  }

  const month = i.today.slice(0, 7);
  const days = i.daysLeftInMonth;
  const over = i.envelopes
    .filter((e) => e.limit > 0 && e.spent > e.limit)
    .sort((a, b) => b.spent - b.limit - (a.spent - a.limit));
  if (over.length) {
    const [top, ...rest] = over;
    const others = rest.map((e) => e.name);
    const resets = `reset ${shortDay(i.resetDay)}`; // "both reset Oct 1"
    out.push({
      key: `env-over:${top.categoryId}:${month}:${cents(top.spent - top.limit)}`,
      severity: 'action',
      emoji: top.emoji ?? '🗂️',
      text:
        days > 0
          ? `${top.name} is {{over}} over its envelope with ${days} day${days === 1 ? '' : 's'} left`
          : `${top.name} is {{over}} over its envelope`,
      context: others.length
        ? `${others.length === 1 ? others[0] : others.slice(0, -1).join(', ') + ' and ' + others.at(-1)} ${others.length === 1 ? 'is' : 'are'} over too · ${others.length === 1 ? 'both' : 'all'} ${resets}`
        : `Resets ${shortDay(i.resetDay)}`,
      figures: { over: money(top.spent - top.limit, top.href) },
      link: { label: 'Plan ›', href: '/plan' },
      short: `${top.name} is over`,
      returns: 'It comes back if the amount over changes.'
    });
  }
  // "Nearly spent" only matters with time left to overspend in.
  if (days >= 5) {
    const nearly = i.envelopes
      .filter((e) => e.limit > 0 && e.spent <= e.limit && e.spent >= e.limit * 0.9)
      .sort((a, b) => b.spent / b.limit - a.spent / a.limit)[0];
    if (nearly) {
      out.push({
        key: `env-nearly:${nearly.categoryId}:${month}:${cents(nearly.limit - nearly.spent)}`,
        severity: 'look',
        emoji: nearly.emoji ?? '🗂️',
        text: `${nearly.name} has {{left}} left with ${days} days to go`,
        context: `Resets ${shortDay(i.resetDay)}`,
        figures: { left: money(nearly.limit - nearly.spent, nearly.href) },
        link: { label: 'Plan ›', href: '/plan' },
        short: `${nearly.name} is nearly spent`,
        returns: 'It comes back if what is left changes.'
      });
    }
  }

  // Checking holding far more than the bills need: the one "do something with
  // it" finding, and the one that says what.
  if (i.monthlyBills > 0) {
    const idle = i.checking - i.monthlyBills * 2;
    if (idle >= IDLE_MIN) {
      const gap = i.averageMonth * CUSHION_MONTHS.short - i.savings.balance;
      const figures: Record<string, Fig> = { idle: money(idle) };
      let context: string;
      if (cushion !== null && gap > 0) {
        figures.move = money(Math.min(gap, idle));
        context =
          gap <= idle
            ? 'Moving {{move}} to savings gets the emergency fund to 3 months'
            : 'Moving {{move}} to savings brings the emergency fund closer to 3 months';
      } else {
        context = 'Savings already covers three months of spending';
      }
      out.push({
        key: `idle:${Math.round(idle / 100)}`,
        severity: 'look',
        emoji: '🏦',
        text: '{{idle}} has sat in checking above two months of bills',
        context,
        figures,
        link: { label: 'Ask about it ›', href: ask('What should I do with the extra cash sitting in checking?') },
        short: 'Extra cash in checking',
        returns: 'It comes back when the amount changes.'
      });
    }
  }

  for (const c of i.priceChanges.slice(0, 2)) {
    const up = c.to > c.from;
    // Twelve a year for a monthly charge, not 365/30 -- "$30.00 more a year".
    const perYear = c.cadenceDays === 30 ? 12 : c.cadenceDays === 365 ? 1 : 365 / c.cadenceDays;
    const yearly = Math.abs(c.to - c.from) * perYear;
    out.push({
      key: `price:${c.id}:${c.to.toFixed(2)}`,
      severity: up ? 'look' : 'good',
      emoji: c.emoji ?? '🔁',
      text: `${c.name} went from {{from}} to {{to}}`,
      context: `From the ${shortDay(c.day)} charge · {{yearly}} ${up ? 'more' : 'less'} a year`,
      figures: { from: money(c.from), to: money(c.to, c.href), yearly: money(Math.round(yearly * 100) / 100) },
      link: { label: 'Recurring ›', href: '/plan?tab=recurring' },
      short: `${c.name} went ${up ? 'up' : 'down'}`,
      returns: 'It comes back if the price changes again.'
    });
  }

  if (i.pace && i.pace.typical > 0) {
    const { projected, typical } = i.pace;
    if (projected > typical * PACE_RATIO && projected - typical >= PACE_MIN) {
      out.push({
        key: `pace:${month}:${Math.round(projected / 100)}`,
        severity: 'look',
        emoji: '🧾',
        text: 'Spending is on pace for {{projected}} this month, against a usual {{typical}}',
        context: `{{spent}} so far · day ${i.pace.day} of ${i.pace.days}`,
        figures: { projected: money(projected), typical: money(typical), spent: money(i.pace.spent, i.pace.href) },
        link: { label: 'Activity ›', href: '/transactions' },
        short: 'Spending is running high',
        returns: 'It comes back if the pace changes.'
      });
    }
  }

  for (const g of i.goalsBehind.slice(0, 1)) {
    out.push({
      key: `goal:${g.id}:${month}`,
      severity: 'look',
      emoji: '🎯',
      text: `${g.name} is behind: lately {{pace}} a month`,
      context: 'Needs {{needed}} a month to finish on time',
      figures: { pace: money(g.pace), needed: money(g.needed) },
      link: { label: 'Goals ›', href: '/plan?tab=goals' },
      short: `${g.name} is behind`,
      returns: 'It comes back next month if it is still behind.'
    });
  }

  if (i.kept && i.kept.income > 0) {
    const k = i.kept;
    const span = `${k.months} month${k.months === 1 ? '' : 's'}`;
    const net = k.income - k.spending;
    const rate = net / k.income;
    const prior = k.before && k.before.income > 0 ? (k.before.income - k.before.spending) / k.before.income : null;
    const extras: string[] = [];
    if (prior !== null) {
      extras.push(`${rate >= prior ? 'Up' : 'Down'} from {{prior}} the ${span} before`);
    }
    if (k.threePaychecks) extras.push(`${k.threePaychecks} had three paychecks`);
    if (net < 0) {
      out.push({
        key: `shortfall:${month}:${cents(-net)}`,
        severity: 'action',
        emoji: '📉',
        text: `You spent {{gap}} more than came in over ${span}`,
        context: extras.length ? extras.join(' · ') : null,
        figures: { gap: money(-net, k.href), ...(prior !== null ? { prior: { kind: 'percent', value: prior } } : {}) },
        link: { label: 'Activity ›', href: '/transactions' },
        short: 'Spending ran past income',
        returns: 'It comes back when the months move on.'
      });
    } else if (rate >= GOOD_RATE) {
      out.push({
        key: `kept:${month}:${Math.round(rate * 100)}`,
        severity: 'good',
        emoji: '🌱',
        text: `You kept {{rate}} of what came in over ${span}`,
        context: extras.length ? extras.join(' · ') : null,
        figures: {
          rate: { kind: 'percent', value: rate, label: 'kept', href: k.href },
          ...(prior !== null ? { prior: { kind: 'percent', value: prior } } : {})
        },
        link: { label: 'Activity ›', href: '/transactions' },
        short: 'A good few months',
        returns: 'It comes back when the months move on.'
      });
    }
  }

  // Stable within a severity: the order above is the order of importance.
  return out
    .map((f, n) => ({ f, n }))
    .sort((a, b) => RANK[a.f.severity] - RANK[b.f.severity] || a.n - b.n)
    .map(({ f }) => f);
}
