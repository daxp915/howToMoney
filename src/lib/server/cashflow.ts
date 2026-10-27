import { and, eq, gte, lt, ne, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import { accounts, categories, transactions } from './db/schema';

/**
 * Cash-flow flows for the Sankey view: where money came from, and where it went.
 *
 * The figures here are deliberately the same ones the dashboard tiles and the
 * budgets page report, so a diagram can never disagree with a number printed
 * beside it. That means the same three exclusions: transfers (paying a card is
 * not an expense -- the purchase it settles already was), rows the user
 * excluded, and investment accounts (a brokerage reports one IRA contribution
 * as three separate positive rows).
 */

export type FlowKind = 'income' | 'expense' | 'savings' | 'deficit';

export interface SankeyNode {
  id: string;
  label: string;
  value: number;
  /** 0 = sources, 1 = the hub, 2 = destinations. */
  column: 0 | 1 | 2;
  color: string | null;
  icon: string | null;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
  kind: FlowKind;
}

export interface CategoryRow {
  /** Null for the uncategorized row and for a folded "Other" band. */
  id: string | null;
  name: string;
  total: number;
  color: string | null;
  icon: string | null;
}

export interface CashFlow {
  nodes: SankeyNode[];
  links: SankeyLink[];
  income: number;
  spending: number;
  net: number;
  /** Full, unfolded lists -- the diagram folds its tail, the tables do not. */
  incomeRows: CategoryRow[];
  expenseRows: CategoryRow[];
}

export const HUB_ID = 'hub';

/**
 * The exclusions every cash-flow figure shares: transfers, excluded rows,
 * pending rows and investment accounts. Expects `transactions` joined to
 * `accounts` and left-joined to `categories`.
 *
 * Exported so the transactions list can show exactly the rows behind a figure
 * (`?flow=out`) without rebuilding the predicate by hand -- a drill-down that
 * summed to something other than the number you clicked would be worse than
 * none.
 */
export function cashFlowScope(): SQL {
  return and(
    eq(transactions.isTransfer, false),
    eq(transactions.excluded, false),
    eq(transactions.pending, false),
    ne(accounts.type, 'investment'),
    sql`coalesce(${categories.group}, 'expense') <> 'transfer'`
  ) as SQL;
}

/** Money in: positive, and only into a deposit account. */
export function incomeSide(): SQL {
  return and(sql`${transactions.amount} > 0`, eq(accounts.type, 'depository')) as SQL;
}

/** Money out: the negative side. Refunds are not netted off. */
export function spendingSide(): SQL {
  return sql`${transactions.amount} < 0`;
}

/**
 * Past roughly nine bands per side the ribbons are thinner than their own
 * labels, so the tail folds into one "Other" node. The tables underneath keep
 * every row, so folding never hides anything.
 */
const MAX_BANDS = 9;

export type RangeKey = 'month' | '3m' | '6m' | '12m' | 'ytd';

export function isRangeKey(v: string | null): v is RangeKey {
  return v === 'month' || v === '3m' || v === '6m' || v === '12m' || v === 'ytd';
}

/** Resolves a range key (and, for `month`, a YYYY-MM) to a half-open window. */
export function resolveRange(range: RangeKey, month: Date): { from: Date; to: Date; label: string } {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  switch (range) {
    case 'month':
      return {
        from: month,
        to: new Date(month.getFullYear(), month.getMonth() + 1, 1),
        label: month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      };
    case '3m':
      return {
        from: new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 2, 1),
        to: nextMonth,
        label: 'Last 3 months'
      };
    case '6m':
      return {
        from: new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 5, 1),
        to: nextMonth,
        label: 'Last 6 months'
      };
    case '12m':
      return {
        from: new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 11, 1),
        to: nextMonth,
        label: 'Last 12 months'
      };
    case 'ytd':
      return {
        from: new Date(now.getFullYear(), 0, 1),
        to: nextMonth,
        label: now.getFullYear() + ' to date'
      };
  }
}

function fold(rows: CategoryRow[]): CategoryRow[] {
  if (rows.length <= MAX_BANDS) return rows;
  const head = rows.slice(0, MAX_BANDS - 1);
  const tail = rows.slice(MAX_BANDS - 1);
  return [
    ...head,
    {
      id: null,
      name: `Other (${tail.length})`,
      total: tail.reduce((s, r) => s + r.total, 0),
      color: null,
      icon: null
    }
  ];
}

export async function cashFlowSankey(from: Date, to: Date): Promise<CashFlow> {
  const base = and(cashFlowScope(), gte(transactions.postedAt, from), lt(transactions.postedAt, to));

  // Income is money landing in a deposit account and nothing else. A positive
  // amount on a card or a loan is a refund or a payment toward the balance --
  // counting those once put a five-figure loan payoff on the page as salary.
  const incomeRaw = await db
    .select({
      id: categories.id,
      name: sql<string>`coalesce(${categories.name}, 'Other income')`,
      color: categories.color,
      icon: categories.icon,
      total: sql<string>`sum(${transactions.amount})`
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(base, incomeSide()))
    .groupBy(categories.id, categories.name, categories.color, categories.icon)
    .orderBy(sql`sum(${transactions.amount}) desc`);

  // Spending is the negative side, sign-flipped. Refunds are not netted off
  // here, because the dashboard's category rollup and the budgets page both
  // count outflow only; a diagram that quietly disagreed with the figure
  // printed beside it would be worse than one that is merely gross.
  const expenseRaw = await db
    .select({
      id: categories.id,
      name: sql<string>`coalesce(${categories.name}, 'Uncategorized')`,
      color: categories.color,
      icon: categories.icon,
      total: sql<string>`sum(-${transactions.amount})`
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(base, spendingSide()))
    .groupBy(categories.id, categories.name, categories.color, categories.icon)
    .orderBy(sql`sum(-${transactions.amount}) desc`);

  const incomeRows: CategoryRow[] = incomeRaw.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    icon: r.icon,
    total: Number(r.total)
  }));
  const expenseRows: CategoryRow[] = expenseRaw.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    icon: r.icon,
    total: Number(r.total)
  }));

  const income = incomeRows.reduce((s, r) => s + r.total, 0);
  const spending = expenseRows.reduce((s, r) => s + r.total, 0);
  const net = income - spending;

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  for (const r of fold(incomeRows)) {
    if (r.total <= 0) continue;
    nodes.push({
      id: `in:${r.name}`,
      label: r.name,
      value: r.total,
      column: 0,
      color: r.color,
      icon: r.icon
    });
    links.push({ source: `in:${r.name}`, target: HUB_ID, value: r.total, kind: 'income' });
  }

  // Spending more than came in has to arrive from somewhere -- savings, or a
  // card balance that grew. Drawing it as a source keeps the hub balanced and
  // makes the shortfall the most visible thing on the page, which is the point.
  if (net < 0) {
    nodes.push({
      id: 'deficit',
      label: 'From savings',
      value: -net,
      column: 0,
      color: null,
      icon: null
    });
    links.push({ source: 'deficit', target: HUB_ID, value: -net, kind: 'deficit' });
  }

  nodes.push({
    id: HUB_ID,
    label: 'Money in',
    value: Math.max(income, spending),
    column: 1,
    color: null,
    icon: null
  });

  for (const r of fold(expenseRows)) {
    if (r.total <= 0) continue;
    nodes.push({
      id: `out:${r.name}`,
      label: r.name,
      value: r.total,
      column: 2,
      color: r.color,
      icon: r.icon
    });
    links.push({ source: HUB_ID, target: `out:${r.name}`, value: r.total, kind: 'expense' });
  }

  if (net > 0) {
    nodes.push({ id: 'saved', label: 'Left over', value: net, column: 2, color: null, icon: null });
    links.push({ source: HUB_ID, target: 'saved', value: net, kind: 'savings' });
  }

  return { nodes, links, income, spending, net, incomeRows, expenseRows };
}
