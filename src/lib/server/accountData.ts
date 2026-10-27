/**
 * "Download my data" and "Delete my account", for the signed-in user.
 *
 * Both run inside the request's own scope: row-level security limits every
 * read to this household, so the export cannot contain anyone else's rows
 * even if a query here forgot a filter.
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import { verify } from '@node-rs/argon2';
import { db } from './db';
import {
  accountBalances,
  accounts,
  advisorConversations,
  advisorTurns,
  budgets,
  categories,
  goals,
  holdingSnapshots,
  importBatches,
  merchants,
  plaidItems,
  recurringSeries,
  rules,
  transactions,
  userPreferences,
  users
} from './db/schema';
import { disconnectPlaidItem } from './plaid/items';

/**
 * Everything the household owns, as plain JSON. Left out on purpose: bank
 * credentials and Plaid tokens (secrets, useless outside this server),
 * sessions, sync logs, and each transaction's raw provider payload (bulky,
 * and the useful parts are already in its columns).
 */
export async function exportData(email: string) {
  const [acct, txns, cats, rls, bud, rec, gls, mer, bal, hold, prefs, convs, turns, imports] = await Promise.all([
    db.select().from(accounts).orderBy(asc(accounts.name)),
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        postedAt: transactions.postedAt,
        transactedAt: transactions.transactedAt,
        amount: transactions.amount,
        description: transactions.description,
        payee: transactions.payee,
        memo: transactions.memo,
        categoryId: transactions.categoryId,
        pending: transactions.pending,
        isTransfer: transactions.isTransfer,
        excluded: transactions.excluded,
        note: transactions.note,
        provider: transactions.provider,
        splitParentId: transactions.splitParentId
      })
      .from(transactions)
      .orderBy(asc(transactions.postedAt)),
    db.select().from(categories),
    db.select().from(rules),
    db.select().from(budgets),
    db.select().from(recurringSeries),
    db.select().from(goals),
    db.select().from(merchants),
    db.select().from(accountBalances),
    db.select().from(holdingSnapshots),
    db.select().from(userPreferences),
    db.select().from(advisorConversations),
    db.select().from(advisorTurns),
    db.select().from(importBatches)
  ]);
  return {
    format: 'howToMoney export',
    version: 1,
    exportedAt: new Date().toISOString(),
    account: email,
    notes: 'Amounts are decimal strings; money out is negative on every account type.',
    accounts: acct,
    transactions: txns,
    categories: cats,
    rules: rls,
    budgets: bud,
    recurring: rec,
    goals: gls,
    merchants: mer,
    dailyBalances: bal,
    holdings: hold,
    preferences: prefs,
    advisor: { conversations: convs, turns },
    imports
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per transaction, with names instead of ids, for a spreadsheet. */
export async function transactionsCsv(): Promise<string> {
  const rows = await db
    .select({
      date: transactions.postedAt,
      account: accounts.name,
      description: transactions.description,
      payee: transactions.payee,
      amount: transactions.amount,
      category: categories.name,
      note: transactions.note,
      pending: transactions.pending,
      transfer: transactions.isTransfer,
      excluded: transactions.excluded
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .orderBy(asc(transactions.postedAt));
  const head = ['date', 'account', 'description', 'payee', 'amount', 'category', 'note', 'pending', 'transfer', 'excluded'];
  return [head.join(','), ...rows.map((r) => head.map((k) => csvCell(r[k as keyof typeof r])).join(','))].join('\r\n') + '\r\n';
}

export type DeleteResult = { ok: true } | { ok: false; message: string; badPassword?: boolean };

/**
 * Deletes the signed-in user and everything they own.
 *
 * Needs the current password (a stolen session alone cannot do it) and the
 * word DELETE typed out. Plaid banks are revoked at Plaid first so billing
 * for them stops. The users row goes through the request's own transaction:
 * every tenant table's `user_id` is ON DELETE CASCADE, so one statement
 * removes the household, and it commits or rolls back with the request.
 */
export async function deleteAccount(
  userId: string,
  password: string,
  confirm: string
): Promise<DeleteResult> {
  if (confirm.trim() !== 'DELETE') return { ok: false, message: 'Type DELETE in capitals to confirm.' };
  const [me] = await db.select().from(users).where(eq(users.id, userId));
  if (!me) return { ok: false, message: 'That account no longer exists.' };
  if (!(await verify(me.passwordHash, password))) return { ok: false, message: 'That password is not right.', badPassword: true };

  if (me.isAdmin) {
    const [other] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.isAdmin, true), ne(users.id, userId)))
      .limit(1);
    if (!other) {
      return {
        ok: false,
        message: 'You are the only admin. Make someone else an admin first, or the server would have nobody to manage it.'
      };
    }
  }

  for (const item of await db.select({ id: plaidItems.id }).from(plaidItems)) {
    await disconnectPlaidItem(item.id);
  }
  await db.delete(users).where(eq(users.id, userId));
  return { ok: true };
}
