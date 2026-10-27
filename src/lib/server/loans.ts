import { and, asc, desc, eq, gt, inArray, isNotNull, ne } from 'drizzle-orm';
import { db } from './db';
import { accountBalances, accounts, transactions } from './db/schema';
import { lastFour } from '../accountName';
import {
  addMonths,
  estimateApr,
  projectPayoff,
  regularPayment,
  type Payoff
} from '../loanMath';

/**
 * Every loan account, with what it takes to answer "when is this done?".
 *
 * A loan payment is two ledger rows: money leaving checking and money landing
 * on the loan. The matcher pairs them as a transfer, which keeps them out of
 * spending -- correctly, since paying down debt moves money between two of
 * your own accounts. The same pairing is why `detectRecurring()` never sees
 * them. This module reads the loan's side instead: positive rows on a `loan`
 * account are payments, whatever the matcher did with them, and the partner
 * leg (when there is one) names the account they come out of.
 *
 * Nothing here feeds `cashFlowScope()`. Loan payments are shown as fixed bills
 * beside spending, never added into it.
 */

export interface LoanRate {
  /** Annual, in percent. */
  apr: number;
  source: 'entered' | 'estimated';
}

export interface Loan {
  id: string;
  name: string;
  nickname: string | null;
  orgName: string | null;
  /** What is owed, positive. */
  owed: number;
  /** Nothing owed and nothing paid in 60 days. A balance that reads zero
   *  the week of a payment is not yet a finished loan. */
  paidOff: boolean;
  /** The last four digits the provider put in the account name. */
  last4: string | null;
  /** The last payments were the same amount: an automatic payment. */
  automatic: boolean;
  /** The regular payment; null when none has been seen. */
  payment: number | null;
  /** Total of the payments on record, and how many. */
  paidTotal: number;
  paymentCount: number;
  firstPaid: string | null;
  lastPaid: string | null;
  /** One month after the last payment. */
  nextDue: string | null;
  /** The account the payments come out of, from the transfer's other leg. */
  fromAccount: { id: string; name: string } | null;
  /** The rate the user entered, as typed; null when they have not. */
  enteredRate: number | null;
  /** The estimate from the balance history, kept even when a rate is entered,
   *  so the rate dialog can name it and offer to go back to it. */
  estimatedRate: number | null;
  rate: LoanRate | null;
  /** At the known or estimated rate. Null without a rate, or when the payment
   *  does not cover the interest. */
  payoff: (Payoff & { date: string }) | null;
  /** At 0%: the earliest the loan could possibly end. Shown until a rate is known. */
  earliest: { payments: number; date: string } | null;
  /** Days of balance history -- the rate estimate needs a payment inside it. */
  historySince: string | null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const PAID_OFF_QUIET_DAYS = 60;

export async function listLoans(): Promise<Loan[]> {
  const loanAccts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      nickname: accounts.nickname,
      orgName: accounts.orgName,
      balance: accounts.balance,
      interestRate: accounts.interestRate
    })
    .from(accounts)
    .where(and(eq(accounts.type, 'loan'), eq(accounts.isActive, true)))
    .orderBy(asc(accounts.name));
  if (!loanAccts.length) return [];
  const ids = loanAccts.map((a) => a.id);

  // Money landing on the loan. Pending rows are left out: a payment that has
  // not posted has not reduced anything yet.
  const pays = await db
    .select({
      accountId: transactions.accountId,
      postedAt: transactions.postedAt,
      amount: transactions.amount,
      transferGroupId: transactions.transferGroupId
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.accountId, ids),
        gt(transactions.amount, '0'),
        eq(transactions.pending, false),
        eq(transactions.excluded, false)
      )
    )
    .orderBy(desc(transactions.postedAt));

  // The other leg of each paired payment, for "paid from". Two plain queries
  // joined in memory rather than a correlated subquery.
  const groups = [...new Set(pays.map((p) => p.transferGroupId).filter((g): g is string => !!g))];
  const legs = groups.length
    ? await db
        .select({
          groupId: transactions.transferGroupId,
          accountId: transactions.accountId,
          name: accounts.name
        })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(
          and(
            inArray(transactions.transferGroupId, groups),
            isNotNull(transactions.transferGroupId),
            ne(accounts.type, 'loan')
          )
        )
    : [];
  const legOf = new Map(legs.map((l) => [l.groupId!, { id: l.accountId, name: l.name }]));

  const balances = await db
    .select({
      accountId: accountBalances.accountId,
      asOf: accountBalances.asOf,
      balance: accountBalances.balance
    })
    .from(accountBalances)
    .where(inArray(accountBalances.accountId, ids))
    .orderBy(asc(accountBalances.asOf));

  return loanAccts.map((a) => {
    const owed = Math.max(0, -Number(a.balance ?? 0));
    const mine = pays.filter((p) => p.accountId === a.id);
    const amounts = mine.map((p) => Number(p.amount));
    const payment = regularPayment(amounts.slice(0, 6));
    const last = mine[0]?.postedAt ?? null;

    // The most recent paired payment decides where the money comes from.
    const paired = mine.find((p) => p.transferGroupId && legOf.has(p.transferGroupId));
    const fromAccount = paired ? legOf.get(paired.transferGroupId!)! : null;

    const history = balances
      .filter((b) => b.accountId === a.id)
      .map((b) => ({ day: b.asOf, owed: Math.max(0, -Number(b.balance)) }));
    const estimated = estimateApr(
      history,
      mine.map((p) => ({ day: isoDay(p.postedAt), amount: Number(p.amount) }))
    );

    const enteredRate = a.interestRate === null ? null : Number(a.interestRate);
    const rate: LoanRate | null =
      enteredRate !== null
        ? { apr: enteredRate, source: 'entered' }
        : estimated !== null
          ? { apr: estimated, source: 'estimated' }
          : null;

    const quiet = !last || Date.now() - last.getTime() > PAID_OFF_QUIET_DAYS * 86400000;
    const paidOff = owed < 0.01 && quiet;
    // Nothing owed means nothing due, even in the quiet weeks before the loan
    // counts as paid off.
    const settled = owed < 0.01;
    const nextDue = !settled && last ? addMonths(last, 1) : null;
    // Payment N lands N-1 months after the next one due.
    const dateOf = (n: number) => (nextDue ? isoDay(addMonths(nextDue, Math.max(0, n - 1))) : null);

    let payoff: Loan['payoff'] = null;
    if (!settled && payment && rate) {
      const p = projectPayoff(owed, payment, rate.apr);
      const date = p ? dateOf(p.payments) : null;
      if (p && date) payoff = { ...p, date };
    }
    let earliest: Loan['earliest'] = null;
    if (!settled && payment) {
      const n = Math.ceil(owed / payment - 1e-9);
      const date = dateOf(n);
      if (date) earliest = { payments: n, date };
    }

    return {
      id: a.id,
      name: a.name,
      nickname: a.nickname,
      orgName: a.orgName,
      owed,
      paidOff,
      last4: lastFour(a.name),
      automatic: amounts.length >= 2 && Math.abs(amounts[0] - amounts[1]) < 0.005,
      payment,
      paidTotal: amounts.reduce((s, v) => s + v, 0),
      paymentCount: amounts.length,
      firstPaid: mine.length ? isoDay(mine[mine.length - 1].postedAt) : null,
      lastPaid: last ? isoDay(last) : null,
      nextDue: nextDue ? isoDay(nextDue) : null,
      fromAccount,
      enteredRate,
      estimatedRate: estimated,
      rate,
      payoff,
      earliest,
      historySince: history[0]?.day ?? null
    };
  });
}

/** The name the user calls a loan ("Tundra loan"); blank goes back to the
 *  provider's. Stored as the account nickname, so every page uses it. */
export async function setLoanName(accountId: string, name: string | null): Promise<boolean> {
  const updated = await db
    .update(accounts)
    .set({ nickname: name?.trim() ? name.trim().slice(0, 60) : null })
    .where(and(eq(accounts.id, accountId), eq(accounts.type, 'loan')))
    .returning({ id: accounts.id });
  return updated.length > 0;
}

/** Set or clear the annual rate the user knows from their statement. */
export async function setLoanRate(accountId: string, apr: number | null): Promise<boolean> {
  const updated = await db
    .update(accounts)
    .set({ interestRate: apr === null ? null : apr.toFixed(3) })
    .where(and(eq(accounts.id, accountId), eq(accounts.type, 'loan')))
    .returning({ id: accounts.id });
  return updated.length > 0;
}
