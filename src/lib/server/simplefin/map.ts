/**
 * SimpleFIN → the app's shape. SimpleFIN already reports money out as
 * negative, so amounts pass through untouched; what this adds is the account
 * type (inferred, SimpleFIN sends none) and the pending-date fallback.
 */
import type { ProviderAccount, ProviderHolding, ProviderTransaction } from '../sync/types';
import { inferAccountType, type SimpleFinAccount, type SimpleFinTransaction } from './client';

export function mapAccount(sf: SimpleFinAccount): ProviderAccount {
  return {
    provider: 'simplefin',
    providerAccountId: sf.id,
    orgName: sf.org?.name ?? sf.org?.domain ?? null,
    name: sf.name,
    type: inferAccountType(sf.name, sf.org?.name, sf.balance),
    currency: sf.currency ?? 'USD',
    balance: sf.balance ?? null,
    availableBalance: sf['available-balance'] ?? null,
    balanceDate: sf['balance-date'] ? new Date(sf['balance-date'] * 1000) : null,
    holdings: Array.isArray(sf.holdings)
      ? sf.holdings.flatMap((h): ProviderHolding[] => {
          const key = (h.symbol?.trim() || h.description?.trim() || h.id).slice(0, 200);
          if (!key || h.shares == null || h.market_value == null) return [];
          return [
            {
              key,
              symbol: h.symbol?.trim() || null,
              description: h.description?.trim() || null,
              shares: h.shares,
              marketValue: h.market_value,
              // "0.00" is SimpleFIN's "not reported" (a 401(k)); a zero basis
              // would read as a 100% gain.
              purchasePrice: Number(h.purchase_price) > 0 ? h.purchase_price! : null,
              currency: h.currency ?? 'USD'
            }
          ];
        })
      : undefined
  };
}

/**
 * Some issuers send pending transactions with `posted: 0` -- there is no post
 * date yet, because it has not posted. Multiplying that by 1000 yields
 * 1970-01-01, which sorts to the bottom of every list, falls outside the
 * transfer matcher's date window, disappears from monthly rollups, and trips
 * the stale-pending cleanup on the very next sync. Fall back to the date the
 * charge was made.
 */
export function resolvePostedAt(t: SimpleFinTransaction): Date {
  if (t.posted) return new Date(t.posted * 1000);
  if (t.transacted_at) return new Date(t.transacted_at * 1000);
  return new Date();
}

export function mapTransaction(t: SimpleFinTransaction): ProviderTransaction {
  return {
    providerTxnId: t.id,
    postedAt: resolvePostedAt(t),
    transactedAt: t.transacted_at ? new Date(t.transacted_at * 1000) : null,
    amount: t.amount,
    description: t.description ?? t.payee ?? '',
    payee: t.payee ?? null,
    memo: t.memo ?? null,
    pending: !!t.pending,
    // SimpleFIN has no pending_transaction_id: `undefined` tells the ledger to
    // reconcile a posted row with its pending one by amount and date.
    replacesPendingId: undefined,
    raw: t as unknown as Record<string, unknown>
  };
}
