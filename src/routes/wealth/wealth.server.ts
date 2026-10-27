import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts, categories, transactions } from '$lib/server/db/schema';
import { cashFlowScope } from '$lib/server/cashflow';
import { feed, paidSide, pickerCategories, readFilters } from '$lib/server/activity';
import { loanDetail, readPeriod, wealthOverview } from '$lib/server/wealth';
import { accountDisplayName, institutionName, lastFour } from '$lib/accountName';
import { drillHref } from '$lib/drill';
import { loadInvestments } from './investments.server';

/**
 * Wealth and its account detail share one load. /wealth opens the first
 * brokerage in the desktop panel; /wealth/<id> opens that account (and, on a
 * phone, is the pushed detail screen).
 */
export async function loadWealth(url: URL, accountId: string | null, holder: string | null) {
  const period = readPeriod(url);
  // An opened account (/wealth/<id>) narrows the hero line to it; /wealth's
  // default panel pick does not, so the plain page is always the whole line.
  const overview = await wealthOverview(period, holder, accountId);
  const all = overview.groups.flatMap((g) => g.rows);
  const pick = accountId ? all.find((r) => r.id === accountId) : all.find((r) => r.type === 'investment');
  return { period, ...overview, pushed: !!accountId, selectedId: pick?.id ?? null, detail: pick ? await detailFor(url, pick.id, pick.type, holder) : null };
}

async function detailFor(url: URL, id: string, type: string, holder: string | null) {
  if (type === 'investment') return { kind: 'investment' as const, inv: await loadInvestments(url, id) };
  if (type === 'loan') {
    const d = await loanDetail(id);
    if (d) return { kind: 'loan' as const, ...d };
  }
  const [a] = await db.select().from(accounts).where(eq(accounts.id, id));
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const from = monthStart.toLocaleDateString('en-CA');
  const [[flow], [paid], recent, cats] = await Promise.all([
    db
      .select({
        income: sql<string>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), 0)`,
        spending: sql<string>`coalesce(sum(case when ${transactions.amount} < 0 then -${transactions.amount} else 0 end), 0)`
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(eq(transactions.accountId, id), cashFlowScope(), gte(transactions.postedAt, monthStart))),
    db
      .select({ sum: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.accountId, id), paidSide(), gte(transactions.postedAt, monthStart))),
    feed({ ...readFilters(new URL('http://x/')), account: [id] }, RECENT),
    pickerCategories()
  ]);
  const card = type === 'credit';
  const balance = Number(a.balance ?? 0);
  const four = lastFour(a.name);
  const name = accountDisplayName(a, holder);
  return {
    kind: 'account' as const,
    account: {
      id,
      type,
      card,
      manual: a.provider === 'manual',
      name,
      // "‹ Visa ··1954": the back link from a transaction to its account.
      short: four ? `${name.split(' ').pop()} ··${four}` : name,
      where:
        a.provider === 'manual'
          ? 'Entered by you'
          : [institutionName(a.orgName), four ? `··${four}` : null].filter(Boolean).join(' '),
      // A card's balance is what is owed: shown as a positive figure with "owed".
      balance: card && balance < 0 ? -balance : balance,
      owed: card && balance < 0,
      available: a.availableBalance === null ? null : Number(a.availableBalance),
      syncedAt: a.lastSyncedAt,
      income: Number(flow?.income ?? 0),
      spending: Number(flow?.spending ?? 0),
      paid: Number(paid?.sum ?? 0),
      inHref: drillHref({ account: id, from, flow: 'in' }),
      outHref: drillHref({ account: id, from, flow: 'out' }),
      paidHref: drillHref({ account: id, from, flow: 'paid' }),
      href: drillHref({ account: id }),
      recent: recent.rows,
      count: recent.total
    },
    categories: cats
  };
}

/** Rows in an account's Recent card; "All N ›" opens the rest in Activity. */
const RECENT = 10;
