/**
 * Plaid → the app's shape. Pure; `npm run test:plaid` covers it.
 *
 * This is the one place Plaid's sign convention is undone. Plaid reports money
 * leaving an account as a POSITIVE amount; the app stores it negative on every
 * account type (money out is always negative). Miss the flip and every
 * rollup inverts: spending reads as income, a paycheck as an expense.
 */
import type { AccountType } from '../simplefin/client';
import type { ProviderAccount, ProviderTransaction } from '../sync/types';
import type { PlaidAccount, PlaidTransaction } from './client';

/**
 * Plaid floats to the app's decimal strings, via whole cents. `toPrecision`
 * strips the float noise (19.99 * 100 = 1998.9999999999998) before rounding,
 * and rounding the magnitude keeps -0.5 cent from rounding toward zero.
 */
export function money(n: number): string {
  const cents = Math.round(Number((Math.abs(n) * 100).toPrecision(12)));
  const signed = n < 0 ? -cents : cents;
  return (signed / 100).toFixed(2).replace(/^-0\.00$/, '0.00');
}

export function accountType(a: Pick<PlaidAccount, 'type'>): AccountType {
  switch (a.type) {
    case 'depository':
    case 'credit':
    case 'loan':
    case 'investment':
      return a.type;
    case 'brokerage':
      return 'investment';
    default:
      return 'other';
  }
}

/**
 * Plaid's `current` on a card or a loan is what is owed, as a positive number.
 * The app holds liabilities negative, which is what net worth and the
 * transfer matcher's card-payment shape both rely on.
 */
export function mapAccount(a: PlaidAccount, orgName: string | null, now = new Date()): ProviderAccount {
  const type = accountType(a);
  const liability = type === 'credit' || type === 'loan';
  const signed = (n: number | null) => (n === null || n === undefined ? null : money(liability ? -n : n));
  const updated = a.balances.last_updated_datetime ? new Date(a.balances.last_updated_datetime) : now;
  return {
    provider: 'plaid',
    providerAccountId: a.account_id,
    orgName,
    // Same "Name (1234)" shape SimpleFIN accounts have, so lists read alike.
    name: a.mask ? `${a.name} (${a.mask})` : a.name,
    type,
    currency: a.balances.iso_currency_code ?? 'USD',
    balance: signed(a.balances.current),
    // Plaid's `available` on a card is remaining credit, not a balance.
    availableBalance: type === 'depository' ? signed(a.balances.available) : null,
    balanceDate: updated
  };
}

/**
 * A Plaid date is a calendar day with no time. Noon UTC lands on that same day
 * in every US time zone; midnight UTC would show as the previous evening in
 * New York and shift month-end rows into the wrong month.
 */
export function dayAt(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

export function mapTransaction(t: PlaidTransaction): ProviderTransaction {
  const description = (t.original_description || t.name || '').trim();
  return {
    providerTxnId: t.transaction_id,
    postedAt: dayAt(t.date),
    transactedAt: t.authorized_date ? dayAt(t.authorized_date) : null,
    amount: money(-t.amount),
    description,
    // The cleaned merchant ("Uber"), which normalizeDescription() keys on
    // first; the raw descriptor stays in `description`.
    payee: t.merchant_name?.trim() || null,
    memo: null,
    pending: !!t.pending,
    replacesPendingId: t.pending_transaction_id ?? null,
    raw: t as unknown as Record<string, unknown>
  };
}
