/**
 * The one shape every bank provider is translated into before it touches the
 * ledger. `sync.ts` writes only these; SimpleFIN and Plaid each have a mapper.
 *
 * The app's invariants are already applied here, by the mapper:
 *  - amounts are decimal strings, money OUT negative, on every account type;
 *  - balances of liabilities (credit, loan) are negative.
 */
import type { AccountType } from '../simplefin/client';

export type Provider = 'simplefin' | 'plaid';

export interface ProviderHolding {
  key: string;
  symbol: string | null;
  description: string | null;
  shares: string;
  marketValue: string;
  purchasePrice: string | null;
  currency: string;
}

export interface ProviderAccount {
  provider: Provider;
  providerAccountId: string;
  orgName: string | null;
  name: string;
  /** Plaid states it; SimpleFIN's is inferred. Only used when the account is first seen. */
  type: AccountType;
  currency: string;
  balance: string | null;
  availableBalance: string | null;
  balanceDate: Date | null;
  /** undefined = the provider said nothing about holdings (leave today's alone). */
  holdings?: ProviderHolding[];
}

export interface ProviderTransaction {
  providerTxnId: string;
  postedAt: Date;
  transactedAt: Date | null;
  /** Decimal string, money out negative. */
  amount: string;
  description: string;
  payee: string | null;
  memo: string | null;
  pending: boolean;
  /**
   * The provider's id of the pending row this posted row replaces, when the
   * provider says so (Plaid). Absent, the ledger falls back to matching by
   * amount and date (SimpleFIN).
   */
  replacesPendingId?: string | null;
  raw: Record<string, unknown>;
}
