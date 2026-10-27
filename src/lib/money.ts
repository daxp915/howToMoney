/**
 * v2 money formatting. Hero and budget figures are whole dollars ("$2,769"),
 * row amounts carry cents ("$141.36"). Spending is shown without a minus --
 * the row already says it is money out -- and income with a "+".
 */
const whole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0
});
const cents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export interface MoneyOpts {
  /** Show cents (default true). */
  cents?: boolean;
  /** Drop the sign (spending shown as a positive amount). */
  abs?: boolean;
  /** Prefix a "+" on positive amounts (income). */
  plus?: boolean;
}

export function usd(value: number | string | null | undefined, opts: MoneyOpts = {}): string {
  let v = Number(value ?? 0);
  if (!Number.isFinite(v)) v = 0;
  if (opts.abs) v = Math.abs(v);
  const f = opts.cents === false ? whole : cents;
  const s = f.format(opts.cents === false ? Math.round(v) : v);
  return opts.plus && v > 0 ? `+${s}` : s;
}
