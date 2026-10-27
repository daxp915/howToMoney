import { and, count, gte, isNotNull } from 'drizzle-orm';
import { db } from './db';
import { merchants, rules, transactions } from './db/schema';

export interface CategoryUsage {
  transactions: number;
  /** Transactions filed under it in the last `recentDays` days. */
  recent: number;
  merchants: number;
  rules: number;
}

/**
 * How much points at each category: transactions filed under it, learned
 * merchants mapped to it, and rules that set it.
 *
 * Three plain grouped counts joined in memory. This used to be three
 * correlated subqueries in a `sql` template inside the categories select, and
 * Drizzle rendered the outer `categories.id` unqualified -- `where
 * "category_id" = "id"` -- which Postgres resolved to the inner table's own
 * id. Every count came back 0, every category read "unused", and deleting one
 * skipped the replacement prompt and quietly uncategorized its history.
 *
 * A category nothing points at is simply absent from the map.
 */
export async function categoryUsage(recentDays = 90): Promise<Map<string, CategoryUsage>> {
  // Whole days, so the transactions list a count links to covers the same rows.
  const since = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
  since.setHours(0, 0, 0, 0);
  const [byTxn, byRecent, byMerchant, byRule] = await Promise.all([
    db
      .select({ id: transactions.categoryId, n: count() })
      .from(transactions)
      .where(isNotNull(transactions.categoryId))
      .groupBy(transactions.categoryId),
    db
      .select({ id: transactions.categoryId, n: count() })
      .from(transactions)
      .where(and(isNotNull(transactions.categoryId), gte(transactions.postedAt, since)))
      .groupBy(transactions.categoryId),
    db
      .select({ id: merchants.categoryId, n: count() })
      .from(merchants)
      .where(isNotNull(merchants.categoryId))
      .groupBy(merchants.categoryId),
    db
      .select({ id: rules.setCategoryId, n: count() })
      .from(rules)
      .where(isNotNull(rules.setCategoryId))
      .groupBy(rules.setCategoryId)
  ]);

  const usage = new Map<string, CategoryUsage>();
  const slot = (id: string) => {
    let u = usage.get(id);
    if (!u) usage.set(id, (u = { transactions: 0, recent: 0, merchants: 0, rules: 0 }));
    return u;
  };
  for (const r of byTxn) if (r.id) slot(r.id).transactions = Number(r.n);
  for (const r of byRecent) if (r.id) slot(r.id).recent = Number(r.n);
  for (const r of byMerchant) if (r.id) slot(r.id).merchants = Number(r.n);
  for (const r of byRule) if (r.id) slot(r.id).rules = Number(r.n);
  return usage;
}
