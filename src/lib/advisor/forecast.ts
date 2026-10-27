import { addDays } from './days';

/**
 * Where cash is headed, day by day, and whether a purchase fits in it.
 *
 * "Cash" is money in deposit accounts less what is owed on cards: a card
 * balance is spent money waiting for its payment date, so a forecast of the
 * checking balance alone would show a windfall the day before every autopay.
 * Measured that way, a card payment moves nothing and a card purchase costs
 * cash the day it is made, which is when the decision was.
 *
 * Known events (paychecks, bills, loan payments) land on their days; everyday
 * spending that follows no schedule is spread evenly at its recent daily rate.
 * The model never computes any of this -- it reads the result.
 */

export type EventKind = 'paycheck' | 'bill' | 'loan' | 'transfer' | 'purchase';

export interface CashEvent {
  /** YYYY-MM-DD */
  day: string;
  /** Signed: money in positive. */
  amount: number;
  label: string;
  kind: EventKind;
  /** A guess rather than a demonstrated schedule (suspected subscription, late pay). */
  estimated?: boolean;
  href?: string | null;
}

export interface ForecastPoint {
  day: string;
  /** Cash at the end of the day. */
  balance: number;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Day 0 is today. Today's events count (a bill due today has usually not
 * posted yet); today's everyday spending does not, because part of it already
 * has and is in the balance.
 */
export function forecastCash(
  start: number,
  today: string,
  days: number,
  events: CashEvent[],
  dailySpend: number
): ForecastPoint[] {
  const byDay = new Map<string, number>();
  for (const e of events) byDay.set(e.day, (byDay.get(e.day) ?? 0) + e.amount);
  const out: ForecastPoint[] = [];
  let balance = start;
  for (let i = 0; i <= days; i++) {
    const day = addDays(today, i);
    balance += byDay.get(day) ?? 0;
    if (i > 0) balance -= dailySpend;
    out.push({ day, balance: round(balance) });
  }
  return out;
}

/** The lowest point on or after `fromDay`; the earliest one on a tie. */
export function lowestPoint(points: ForecastPoint[], fromDay = points[0].day): ForecastPoint {
  const rest = points.filter((p) => p.day >= fromDay);
  return rest.reduce((best, p) => (p.balance < best.balance ? p : best), rest[0]);
}

export interface Affordability {
  verdict: 'now' | 'wait' | 'no';
  amount: number;
  floor: number;
  /** The day asked about (today unless a date was given). */
  asked: string;
  /** The first day it fits, or null. */
  buyDay: string | null;
  /** What makes the later day work -- usually a paycheck. */
  unlockedBy: CashEvent | null;
  /** The lowest cash reaches after buying on `buyDay` (or on `asked` when it never fits). */
  lowest: ForecastPoint;
  /** How far above the floor that lowest point is; negative is a shortfall. */
  cushion: number;
  /** The biggest bills between the purchase and that lowest point. */
  dueBefore: CashEvent[];
}

/**
 * The purchase fits on day d when cash stays at or above the floor from d to
 * the end of the forecast after paying for it. Only the first `days - tail`
 * days are candidates: a purchase near the horizon would look safe merely
 * because nothing after it is being checked.
 */
export function affordability(
  points: ForecastPoint[],
  events: CashEvent[],
  amount: number,
  floor: number,
  asked?: string,
  tail = 14
): Affordability {
  const n = points.length;
  // Lowest balance from each day to the end.
  const minAfter = new Array<number>(n);
  const minDayAfter = new Array<string>(n);
  for (let i = n - 1; i >= 0; i--) {
    // `<=`: on a tie the earlier day is the low point, the same one
    // `lowestPoint()` and the chart pick.
    if (i === n - 1 || points[i].balance <= minAfter[i + 1]) {
      minAfter[i] = points[i].balance;
      minDayAfter[i] = points[i].day;
    } else {
      minAfter[i] = minAfter[i + 1];
      minDayAfter[i] = minDayAfter[i + 1];
    }
  }

  const askedDay = asked && asked > points[0].day ? asked : points[0].day;
  const start = Math.max(0, points.findIndex((p) => p.day >= askedDay));
  const lastCandidate = Math.max(start, n - 1 - tail);

  let found = -1;
  for (let i = start; i <= lastCandidate; i++) {
    if (minAfter[i] - amount >= floor) {
      found = i;
      break;
    }
  }

  const at = found === -1 ? start : found;
  const buyDay = found === -1 ? null : points[found].day;
  const lowest = { day: minDayAfter[at], balance: round(minAfter[at] - amount) };
  const dueBefore = events
    .filter((e) => e.amount < 0 && e.day >= points[at].day && e.day <= lowest.day)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 3);

  let unlockedBy: CashEvent | null = null;
  if (found > start) {
    unlockedBy =
      events
        .filter((e) => e.amount > 0 && e.day > points[start].day && e.day <= points[found].day)
        .sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
  }

  return {
    verdict: found === -1 ? 'no' : found === start ? 'now' : 'wait',
    amount,
    floor,
    asked: points[start].day,
    buyDay,
    unlockedBy,
    lowest,
    cushion: round(lowest.balance - floor),
    dueBefore
  };
}
