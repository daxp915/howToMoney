/**
 * Loan arithmetic. Pure -- no database -- so it is covered by
 * `npm run test:loans` against numbers worked out by hand.
 *
 * Balances here are what is owed, as a positive number. The ledger stores
 * debt negative; the caller flips it once on the way in.
 */

/** The same day of the month, `n` months later, clamped to the month's end
 *  (a payment due on the 31st falls on the 30th in a 30-day month). */
export function addMonths(d: Date, n: number): Date {
  const day = d.getUTCDate();
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/**
 * The regular payment: the amount paid most often among the recent ones, the
 * latest on a tie. A payoff or a one-off extra payment is the odd one out, and
 * a mean would drag the projection toward it -- the Pinecrest Bank refinance paid
 * $615.04 twice and then $47,888.65 once.
 */
export function regularPayment(amounts: number[]): number | null {
  if (!amounts.length) return null;
  const counts = new Map<number, number>();
  for (const a of amounts) counts.set(a, (counts.get(a) ?? 0) + 1);
  // `amounts` is newest first, so the first to reach the top count wins ties.
  let best = amounts[0];
  for (const a of amounts) if ((counts.get(a) ?? 0) > (counts.get(best) ?? 0)) best = a;
  return best;
}

export interface Payoff {
  /** Payments left, the last one usually smaller. */
  payments: number;
  /** Interest still to be paid over those payments. */
  interest: number;
}

/**
 * How many payments of `payment` clear `balance` at `aprPct`, compounding
 * monthly -- the way car loans and student loans amortize. Simulated rather
 * than solved in closed form so the last, partial payment is exact.
 *
 * Null when the payment does not cover a month's interest: that loan never
 * ends, and printing a date for it would be a lie.
 */
export function projectPayoff(balance: number, payment: number, aprPct: number): Payoff | null {
  if (balance <= 0) return { payments: 0, interest: 0 };
  if (payment <= 0) return null;
  const r = aprPct / 100 / 12;
  if (balance * r >= payment) return null;
  let owed = balance;
  let interest = 0;
  let payments = 0;
  // 1200 months is a century; nothing real gets near it, and it bounds the loop.
  while (owed > 0.005 && payments < 1200) {
    const accrued = Math.round(owed * r * 100) / 100;
    interest += accrued;
    owed += accrued - payment;
    payments++;
  }
  return { payments, interest: Math.round(interest * 100) / 100 };
}

export interface BalancePoint {
  /** YYYY-MM-DD */
  day: string;
  /** Owed, positive. */
  owed: number;
}

export interface PaymentPoint {
  /** YYYY-MM-DD */
  day: string;
  amount: number;
}

/**
 * An annual rate, estimated from how the balance fell against the payments.
 *
 * Across a stretch of days containing exactly one payment, whatever the
 * balance fell by *less* than that payment is interest. Lenders' feeds differ
 * -- some accrue daily, some only move the balance when a payment posts -- but
 * across roughly a month either way the difference is about one month's
 * interest, so the stretch has to be at least `minDays` long, and it has to
 * start before the payment so the payment is inside it.
 *
 * Returns the estimate from the latest usable stretch, or null. An estimate
 * outside 0-40% means the feed moved for some other reason (a fee, a
 * correction, a missed day) and is discarded rather than shown.
 */
export function estimateApr(
  balances: BalancePoint[],
  payments: PaymentPoint[],
  minDays = 25
): number | null {
  const pts = [...balances].sort((a, b) => a.day.localeCompare(b.day));
  const pays = [...payments].sort((a, b) => a.day.localeCompare(b.day));
  const dayMs = 86400000;
  const between = (d: string) => Date.parse(d + 'T12:00:00Z');

  for (let k = pays.length - 1; k >= 0; k--) {
    const p = pays[k];
    // The first snapshot after the previous payment and before this one --
    // the longest stretch holding this payment and no other...
    const prev = pays[k - 1];
    const start = pts.find((b) => b.day < p.day && (!prev || b.day > prev.day));
    if (!start) continue;
    // ...and the last snapshot before the next payment (or the newest one).
    const next = pays[k + 1];
    const end = [...pts].reverse().find((b) => b.day >= p.day && (!next || b.day < next.day));
    if (!end) continue;
    const days = (between(end.day) - between(start.day)) / dayMs;
    if (days < minDays || start.owed <= 0) continue;
    const interest = end.owed - start.owed + p.amount;
    const apr = (interest / start.owed) * (365 / days) * 100;
    if (apr >= 0 && apr <= 40) return Math.round(apr * 100) / 100;
  }
  return null;
}
