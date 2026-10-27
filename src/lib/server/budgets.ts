import { and, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from './db';
import { accounts, budgets, categories, transactions } from './db/schema';
import { cashFlowScope, spendingSide } from './cashflow';

export interface BudgetRow {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string;
  /** The limit in force for the month asked about. */
  amount: number;
  /** True when this month has its own override rather than the default. */
  isOverride: boolean;
  spent: number;
}

export function monthStart(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function monthEnd(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/**
 * Budgets for one month, with what has been spent against each.
 *
 * Only expense categories can be budgeted -- a limit on income or on transfers
 * between your own accounts is meaningless.
 */
export async function budgetsForMonth(month: Date): Promise<BudgetRow[]> {
  const from = monthStart(month);
  const to = monthEnd(month);

  const rows = await db
    .select({
      categoryId: categories.id,
      name: categories.name,
      icon: categories.icon,
      color: categories.color,
      // An override for this month wins over the recurring default.
      overrideAmount: sql<string | null>`max(case when ${budgets.month} is not null then ${budgets.amount} end)`,
      defaultAmount: sql<string | null>`max(case when ${budgets.month} is null then ${budgets.amount} end)`
    })
    .from(categories)
    .leftJoin(
      budgets,
      and(
        eq(budgets.categoryId, categories.id),
        or(isNull(budgets.month), eq(budgets.month, from))
      )
    )
    .where(eq(categories.group, 'expense'))
    .groupBy(categories.id, categories.name, categories.icon, categories.color, categories.sortOrder)
    .orderBy(categories.sortOrder, categories.name);

  const spendRows = await db
    .select({
      categoryId: transactions.categoryId,
      spent: sql<string>`sum(-${transactions.amount})`
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        // The same predicate as every other cash-flow figure and the
        // transactions drill-down, so an envelope's "spent" and the list it
        // links to cannot disagree.
        cashFlowScope(),
        spendingSide(),
        gte(transactions.postedAt, from),
        lt(transactions.postedAt, to)
      )
    )
    .groupBy(transactions.categoryId);

  const spentByCategory = new Map(
    spendRows.filter((r) => r.categoryId).map((r) => [r.categoryId as string, Number(r.spent)])
  );

  return rows.map((r) => {
    const override = r.overrideAmount === null ? null : Number(r.overrideAmount);
    const fallback = r.defaultAmount === null ? null : Number(r.defaultAmount);
    return {
      categoryId: r.categoryId,
      name: r.name,
      icon: r.icon,
      color: r.color,
      amount: override ?? fallback ?? 0,
      isOverride: override !== null,
      spent: spentByCategory.get(r.categoryId) ?? 0
    };
  });
}

/** Writes a limit. `month` null sets the recurring default; 0 clears it. */
export async function setBudget(
  categoryId: string,
  amount: number,
  month: Date | null
): Promise<void> {
  if (amount <= 0) {
    await db
      .delete(budgets)
      .where(
        and(
          eq(budgets.categoryId, categoryId),
          month === null ? isNull(budgets.month) : eq(budgets.month, month)
        )
      );
    return;
  }

  await db
    .insert(budgets)
    .values({ categoryId, month, amount: amount.toFixed(2) })
    .onConflictDoUpdate({
      target: [budgets.userId, budgets.categoryId, budgets.month],
      set: { amount: amount.toFixed(2), updatedAt: new Date() }
    });
}
