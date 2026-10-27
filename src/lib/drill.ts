/**
 * Links into the transactions list, filtered to the rows behind a figure.
 *
 * Every number that is a sum of transactions -- a category, an envelope, a
 * recurring charge, a goal -- links here, so the question "which transactions
 * make this up?" is always one click. `flow` narrows to rows that count toward
 * a cash-flow figure through the same predicate the figures use, so the list's
 * total matches the number that was clicked.
 */
export interface Drill {
  /** A category id, or null for rows without a category. */
  category?: string | null;
  merchant?: string | null;
  /** One account id, or several. */
  account?: string | string[] | null;
  from?: Date | string | null;
  to?: Date | string | null;
  /** `paid`: payments a card or loan received (transfer legs in). */
  flow?: 'in' | 'out' | 'paid' | null;
  /** Posted rows only. */
  settled?: boolean;
}

/** YYYY-MM-DD in local time -- the transactions filter's date format. */
export function isoDay(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-CA');
}

/** The first and last day of the month containing `d`. */
export function monthBounds(d: Date = new Date()): { from: string; to: string } {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: isoDay(first), to: isoDay(last) };
}

export function drillHref(d: Drill): string {
  const p = new URLSearchParams();
  if (d.category !== undefined) p.set('category', d.category ?? 'none');
  if (d.merchant) p.set('merchant', d.merchant);
  if (d.account?.length) p.set('account', Array.isArray(d.account) ? d.account.join(',') : d.account);
  if (d.from) p.set('from', typeof d.from === 'string' ? d.from : isoDay(d.from));
  if (d.to) p.set('to', typeof d.to === 'string' ? d.to : isoDay(d.to));
  if (d.flow) p.set('flow', d.flow);
  if (d.settled) p.set('settled', '1');
  return `/transactions?${p.toString()}`;
}
