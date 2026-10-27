import { addDays, dayOfMonth, daysBetween, daysInMonth, median, monthsLater, onDayOfMonth } from './days';

/**
 * When money is expected to arrive. `detectRecurring()` only looks at money
 * leaving (a subscription is a charge), so paycheck timing -- the half of
 * "can I afford this before the 15th?" that is not a bill -- is found here,
 * from deposits, by the same kind of arithmetic: a deposit from one source
 * that lands on a steady schedule for roughly the same amount.
 *
 * Pure, so `npm run test:advisor` covers it with dates worked out by hand.
 */

export interface Deposit {
  /** YYYY-MM-DD */
  day: string;
  amount: number;
  /** The merchant key -- one employer is one key. */
  key: string;
  name: string;
  accountId: string;
}

export type PayCadence = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export interface PaySeries {
  key: string;
  name: string;
  accountId: string;
  cadence: PayCadence;
  /** The usual amount: median of the last three. */
  typical: number;
  occurrences: number;
  lastDay: string;
  /**
   * For semimonthly and monthly: the days of the month it lands on. Zero or
   * below counts back from the month's last day (0 = the last day, -1 = the
   * day before), because an end-of-month check lands a day or two early.
   */
  anchors: number[];
}

export interface ExpectedPay {
  day: string;
  amount: number;
  series: PaySeries;
  /** Was due already and has not shown up; placed tomorrow rather than dropped. */
  late: boolean;
}

/** Deposits below this are interest, cashback and refunds, not pay. A
 *  monthly $38 interest credit is regular, but calling it a paycheck reads as
 *  nonsense and moves no forecast. */
const MIN_AMOUNT = 100;
/** How far a paycheck may vary and still be the same paycheck -- overtime,
 *  a changed deduction. A bonus is the odd one out and does not break it. */
const AMOUNT_TOLERANCE = 0.35;
/** A paycheck this many days past due is treated as late, not as stopped. */
const LATE_GRACE = 5;

const CADENCE_DAYS: Record<PayCadence, number> = {
  weekly: 7,
  biweekly: 14,
  semimonthly: 15,
  monthly: 30
};

const within = (xs: number[], centre: number, tol: number) =>
  xs.every((x) => Math.abs(x - centre) <= tol);

/**
 * The two days of the month a semimonthly check lands on, or null. Every
 * deposit has to sit near one of two anchors half a month apart. Biweekly pay
 * also lands in both halves of a month, which is why this is only asked after
 * the exact-14-day test has failed.
 */
function semimonthlyAnchors(days: string[], slack = 3): number[] | null {
  // A check due on the 1st that falls on a weekend is paid on the 30th or
  // 31st. The last few days of a month count as day 0 of the next, so they
  // join the early half; an anchor of 0 then means the last day of the month
  // (the 15th-and-last pattern).
  const doms = days.map((d) => {
    const dom = dayOfMonth(d);
    return dom > daysInMonth(d) - slack ? dom - daysInMonth(d) : dom;
  });
  // Consecutive checks alternate between the two anchors, so alternate
  // deposits form the two groups -- splitting at the 15th would put a check
  // paid a day early on the wrong side.
  const a = doms.filter((_, i) => i % 2 === 0);
  const b = doms.filter((_, i) => i % 2 === 1);
  if (!a.length || !b.length) return null;
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  if (spread(a) > 4 || spread(b) > 4) return null;
  const [early, late] = [Math.round(median(a)), Math.round(median(b))].sort((x, y) => x - y);
  if (late - early < 10 || late - early > 20) return null;
  // Kept below zero: "two days before the month ends" is the pattern a payroll
  // that pays the last business day early actually shows.
  return [early, late];
}

function classify(days: string[]): { cadence: PayCadence; anchors: number[] } | null {
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(daysBetween(days[i - 1], days[i]));
  if (!gaps.length) return null;
  const typical = median(gaps);

  if (Math.abs(typical - 7) <= 2 && within(gaps, 7, 3)) return { cadence: 'weekly', anchors: [] };
  if (typical >= 12 && typical <= 18) {
    // Biweekly lands exactly 14 days apart, give or take a bank holiday;
    // semimonthly wobbles between 13 and 18 with the length of the month.
    if (within(gaps, 14, 1)) return { cadence: 'biweekly', anchors: [] };
    // An end-of-month check can come several days early (a weekend, a
    // holiday, a payroll that runs on the 27th of a 31-day month): try the
    // strict window first, then a wider one.
    const anchors = semimonthlyAnchors(days) ?? semimonthlyAnchors(days, 5);
    if (anchors) return { cadence: 'semimonthly', anchors };
    if (within(gaps, 14, 3)) return { cadence: 'biweekly', anchors: [] };
    return null;
  }
  if (Math.abs(typical - 30) <= 5 && within(gaps, 30, 7)) {
    return { cadence: 'monthly', anchors: [Math.round(median(days.map(dayOfMonth)))] };
  }
  return null;
}

export function detectPaychecks(deposits: Deposit[], today: string): PaySeries[] {
  const groups = new Map<string, Deposit[]>();
  for (const d of deposits) {
    if (d.amount < MIN_AMOUNT) continue;
    const k = `${d.accountId}::${d.key}`;
    const g = groups.get(k);
    if (g) g.push(d);
    else groups.set(k, [d]);
  }

  const out: PaySeries[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.day.localeCompare(b.day));
    // Two deposits the same day from one source are one paycheck split in two.
    const byDay = new Map<string, number>();
    for (const d of group) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.amount);
    const days = [...byDay.keys()];
    const amounts = [...byDay.values()];

    const shape = classify(days);
    if (!shape) continue;
    // A monthly deposit shows at most three times in SimpleFIN's window, so two
    // is enough there; anything more frequent has to show three.
    if (days.length < (shape.cadence === 'monthly' ? 2 : 3)) continue;

    const mid = median(amounts);
    const fits = amounts.filter((a) => Math.abs(a - mid) <= mid * AMOUNT_TOLERANCE).length;
    if (fits < Math.ceil(amounts.length * 0.75)) continue;

    const lastDay = days[days.length - 1];
    // Two missed cycles means it stopped -- a job change, a closed account.
    if (daysBetween(lastDay, today) > CADENCE_DAYS[shape.cadence] * 2 + LATE_GRACE) continue;

    const recent = amounts.slice(-3).filter((a) => Math.abs(a - mid) <= mid * AMOUNT_TOLERANCE);
    const last = group[group.length - 1];
    out.push({
      key: last.key,
      name: last.name,
      accountId: last.accountId,
      cadence: shape.cadence,
      typical: Math.round(median(recent.length ? recent : amounts) * 100) / 100,
      occurrences: days.length,
      lastDay,
      anchors: shape.anchors
    });
  }
  return out.sort((a, b) => b.typical - a.typical);
}

/** Payroll moves a date that falls on a weekend to the Friday before. */
function weekday(day: string): string {
  const dow = new Date(day + 'T12:00:00Z').getUTCDay();
  return dow === 6 ? addDays(day, -1) : dow === 0 ? addDays(day, -2) : day;
}

/** An anchor's date in `month` (any day of it); see `PaySeries.anchors`. */
function onAnchor(month: string, a: number): string {
  return a <= 0 ? addDays(onDayOfMonth(month, 31), a) : onDayOfMonth(month, a);
}

/** The pay dates after `series.lastDay`, in order, up to `until`. */
function scheduleAfter(series: PaySeries, until: string): string[] {
  const out: string[] = [];
  const { cadence, lastDay, anchors } = series;
  if (cadence === 'weekly' || cadence === 'biweekly') {
    const step = CADENCE_DAYS[cadence];
    for (let d = addDays(lastDay, step); d <= until; d = addDays(d, step)) out.push(d);
    return out;
  }
  // Month-anchored: walk months from the last pay's, keeping dates after it.
  for (let m = 0; m < 24; m++) {
    const month = monthsLater(lastDay, m);
    for (const a of anchors) {
      const d = weekday(onAnchor(month, a));
      if (d > lastDay && d <= until) out.push(d);
    }
    if (month > until) break;
  }
  return out.sort();
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const anchorWords = (a: number) =>
  a === 0 ? 'the last day of the month' : a < 0 ? `${-a} day${a === -1 ? '' : 's'} before month end` : `the ${ordinal(a)}`;

/**
 * Why a paycheck is expected when it is, in words: every date shown for pay
 * that has not landed is a prediction, and the page says so and on what.
 */
export function payBasis(s: PaySeries): string {
  const pattern =
    s.cadence === 'weekly'
      ? 'every week'
      : s.cadence === 'biweekly'
        ? 'every two weeks'
        : s.anchors.map(anchorWords).join(' and ');
  const weekend = s.cadence === 'semimonthly' || s.cadence === 'monthly' ? ' (a weekend moves to the Friday before)' : '';
  return `Predicted from ${s.occurrences} past paychecks · usually ${pattern}${weekend}`;
}

/**
 * Paychecks expected from `today` through `until`. One already due that has
 * not arrived is placed tomorrow and marked late: banks and SimpleFIN both
 * run a day or two behind (some banks send no pending deposits at all), and dropping
 * it would make every forecast needlessly bleak. Past the grace period it is
 * dropped -- something has changed and the forecast should not bank on it.
 */
export function expectedPay(series: PaySeries[], today: string, until: string): ExpectedPay[] {
  const out: ExpectedPay[] = [];
  const tomorrow = addDays(today, 1);
  for (const s of series) {
    for (const day of scheduleAfter(s, until)) {
      if (day < today) {
        if (daysBetween(day, today) <= LATE_GRACE) out.push({ day: tomorrow, amount: s.typical, series: s, late: true });
        continue;
      }
      out.push({ day, amount: s.typical, series: s, late: false });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}
