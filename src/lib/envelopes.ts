/**
 * Budget status, v2: the one rule every category row, Home's budget list and
 * Plan's groups share, so no two can disagree about when a category is
 * "Watch".
 *
 *   spent <= 85% of budget   ok     (green bar)
 *   85% < spent <= 100%      watch  (yellow bar, "Watch" tag)
 *   spent > 100%             over   (red bar, "$26 over" tag)
 *
 * A bill paid exactly in full is ok, not watch: paying rent is the plan going
 * right, and it shows a green check instead.
 */
export const WATCH_FROM = 0.85;

export type BudgetStatus = 'none' | 'ok' | 'watch' | 'over';

export interface BudgetState {
  status: BudgetStatus;
  /** Fill of the bar, 0..1. */
  fill: number;
  /** Positive when over. */
  overBy: number;
  /** A bill paid exactly in full (status ok, shows a check). */
  paid: boolean;
}

export function budgetState(spent: number, budget: number, bill = false): BudgetState {
  if (!(budget > 0)) return { status: 'none', fill: 0, overBy: 0, paid: false };
  const ratio = spent / budget;
  const fill = Math.max(0, Math.min(1, ratio));
  // Cents of rounding either way still count as "paid in full".
  const paid = bill && Math.abs(spent - budget) < 0.5;
  if (paid) return { status: 'ok', fill: 1, overBy: 0, paid: true };
  if (spent > budget + 0.004) return { status: 'over', fill: 1, overBy: spent - budget, paid: false };
  if (ratio > WATCH_FROM) return { status: 'watch', fill, overBy: 0, paid: false };
  return { status: 'ok', fill, overBy: 0, paid: false };
}

// ---- legacy: the pre-v2 Envelopes page, until Plan is rebuilt ----
export type EnvelopeStatus = 'untouched' | 'plenty' | 'nearly' | 'over';
export function envelopeStatus(spent: number, limit: number): EnvelopeStatus {
  if (spent > limit) return 'over';
  if (spent <= 0) return 'untouched';
  if (spent > limit * WATCH_FROM) return 'nearly';
  return 'plenty';
}
export const STATUS_LABEL: Record<EnvelopeStatus, string> = {
  untouched: 'Untouched',
  plenty: 'Plenty left',
  nearly: 'Nearly spent',
  over: 'Over'
};
