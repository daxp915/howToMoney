import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { accounts, categories, transactions } from './db/schema';
import { normalizeDescription } from './sync/normalize';

/**
 * Money the bank feed will never see.
 *
 * SimpleFIN imports everything that touches a card or an account, which makes a
 * general "add expense" button a duplicate generator: the row you type today is
 * the row the provider reports tomorrow, under its own id, and nothing
 * reconciles the two because they came from different providers. So manual
 * entry is restricted to accounts no provider owns -- cash, and anything else
 * you choose to track by hand. That is the gap the feed actually leaves, and it
 * is the one place a typed row cannot collide with an imported one.
 *
 * `provider = 'manual'` keeps these rows out of every provider's way: the
 * unique index is (user_id, provider, provider_txn_id), so a manual id can
 * never collide with a SimpleFIN or CSV one, and a sync that stops returning an
 * account will not deactivate this one.
 */
export const MANUAL_PROVIDER = 'manual';

export interface ManualAccount {
  id: string;
  name: string;
  type: string;
  balance: string | null;
}

/** Every account no provider feeds -- the only ones you may type into. */
export async function manualAccounts(): Promise<ManualAccount[]> {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      balance: accounts.balance
    })
    .from(accounts)
    .where(and(eq(accounts.provider, MANUAL_PROVIDER), eq(accounts.isActive, true)))
    .orderBy(accounts.name);
}

/**
 * The starter cash account, created the first time somebody needs one.
 *
 * Made on demand rather than seeded: an account that exists before it holds
 * anything is one more empty row on the balance sheet for everybody who never
 * spends cash.
 */
export async function ensureCashAccount(): Promise<ManualAccount> {
  const existing = await manualAccounts();
  if (existing.length) return existing[0];

  const [created] = await db
    .insert(accounts)
    .values({
      provider: MANUAL_PROVIDER,
      providerAccountId: 'cash',
      name: 'Cash',
      type: 'depository',
      balance: '0',
      isActive: true
    })
    .returning({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      balance: accounts.balance
    });

  return created;
}

export interface NewExpense {
  accountId: string;
  /** Always positive here; the sign is applied below. */
  amount: number;
  merchant: string;
  postedAt: Date;
  categoryId?: string | null;
  note?: string | null;
  /** True for money coming in rather than going out. */
  isIncome?: boolean;
}

export interface ManualResult {
  id: string;
}

/**
 * Writes one hand-entered transaction.
 *
 * Three things this has to get right, all of them invariants the rest of the
 * app depends on:
 *
 * - **The sign.** Money out is negative on every account type. A positive
 *   expense would be counted as income by every rollup in the app.
 * - **The account.** Refused unless it is a manual one, so a typed row can
 *   never sit alongside the provider's own copy of the same purchase.
 * - **`categorySource`.** A category you picked is `'user'`, which is what keeps
 *   it out of every bulk re-categorization for good.
 */
export async function addManualTransaction(input: NewExpense): Promise<ManualResult> {
  const amount = Math.abs(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Enter an amount greater than zero.');
  }

  const merchant = input.merchant.trim();
  if (!merchant) throw new Error('Give it a name, so you can find it later.');

  // The account is re-read rather than trusted from the form: this is the check
  // that stops a hand-typed row landing in a synced account, and a hidden field
  // is not where a rule like that belongs.
  const [account] = await db
    .select({ id: accounts.id, provider: accounts.provider, balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.id, input.accountId))
    .limit(1);

  if (!account) throw new Error('That account no longer exists.');
  if (account.provider !== MANUAL_PROVIDER) {
    throw new Error(
      'That account is fed by your bank, so entries there arrive on their own. ' +
        'Manual entries go to a cash or hand-tracked account.'
    );
  }

  if (input.categoryId) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      .limit(1);
    if (!category) throw new Error('That category no longer exists.');
  }

  // Money out is negative, on every account type. Everything downstream --
  // spending rollups, the flow diagram, budgets, net worth -- reads the sign.
  const signed = input.isIncome ? amount : -amount;

  const [row] = await db
    .insert(transactions)
    .values({
      accountId: account.id,
      provider: MANUAL_PROVIDER,
      providerTxnId: `manual:${crypto.randomUUID()}`,
      postedAt: input.postedAt,
      amount: signed.toFixed(2),
      description: merchant,
      merchantName: merchant,
      // The same normalizer every other source goes through, so a hand-typed
      // "Blue Bottle" learns and matches exactly like an imported one.
      normalizedKey: normalizeDescription(merchant),
      categoryId: input.categoryId ?? null,
      categorySource: input.categoryId ? 'user' : 'none',
      pending: false,
      note: input.note?.trim() || null,
      raw: { source: 'manual' }
    })
    .returning({ id: transactions.id });

  // A manual account has no feed to correct its balance, so the running total
  // is only ever what these rows add up to. A synced account's balance is the
  // provider's to state and is never adjusted from here.
  await db
    .update(accounts)
    .set({ balance: (Number(account.balance ?? 0) + signed).toFixed(2) })
    .where(eq(accounts.id, account.id));

  return { id: row.id };
}
