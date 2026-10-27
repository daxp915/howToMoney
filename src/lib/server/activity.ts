/**
 * Activity: the feed, the in/out bars over it, the
 * month-in-review cards between months, one transaction's detail, and
 * splitting.
 *
 * Splitting writes parts as rows of their own (provider 'split', pointing at
 * the parent) and sets the parent `excluded`. Every rollup already leaves
 * excluded rows out and counts the parts instead, so budgets, cash flow and
 * the drill-down lists move to the parts without a single filter changing.
 * Undo deletes the parts and clears the flag.
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import { accounts, categories, recurringSeries, rules, transactions } from './db/schema';
import { cashFlowScope, incomeSide, spendingSide } from './cashflow';
import { applyUserCategory } from './ai/feedback';
import { toReview, UUID } from './review';
import { cleanMerchant } from '../merchantName';
import { accountDisplayName, lastFour } from '../accountName';
import { drillHref } from '../drill';

export interface FeedFilters {
  q: string;
  account: string[];
  category: string;
  merchant: string;
  from: string;
  to: string;
  /** `paid`: payments received by a card or loan -- transfer legs coming in. */
  flow: '' | 'in' | 'out' | 'paid';
  settled: boolean;
  review: boolean;
}

export function readFilters(url: URL): FeedFilters {
  const flow = url.searchParams.get('flow');
  return {
    q: url.searchParams.get('q')?.trim() ?? '',
    account: (url.searchParams.get('account') ?? '').split(',').filter((id) => UUID.test(id)),
    category: url.searchParams.get('category') ?? '',
    merchant: url.searchParams.get('merchant')?.trim() ?? '',
    from: /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from') ?? '') ? url.searchParams.get('from')! : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('to') ?? '') ? url.searchParams.get('to')! : '',
    flow: flow === 'in' || flow === 'out' || flow === 'paid' ? flow : '',
    settled: url.searchParams.get('settled') === '1',
    review: url.searchParams.get('review') === '1'
  };
}

/** The predicate a filter set means. Drill-down semantics are unchanged from
 *  the old transactions page, so every figure's link still sums to it. */
export function feedWhere(f: FeedFilters): SQL | undefined {
  const w: SQL[] = [];
  if (f.q) {
    // Merchants, categories and amounts: "64.30" finds the row.
    const num = Number(f.q.replace(/[$,\s]/g, ''));
    const parts = [
      ilike(transactions.description, `%${f.q}%`),
      ilike(transactions.merchantName, `%${f.q}%`),
      ilike(categories.name, `%${f.q}%`)
    ];
    if (Number.isFinite(num) && /\d/.test(f.q)) parts.push(sql`abs(${transactions.amount}) = ${Math.abs(num)}`);
    w.push(or(...parts) as SQL);
  }
  if (f.account.length === 1) w.push(eq(transactions.accountId, f.account[0]));
  else if (f.account.length > 1) w.push(inArray(transactions.accountId, f.account));
  if (f.from) w.push(gte(transactions.postedAt, new Date(f.from + 'T00:00:00')));
  if (f.to) w.push(lte(transactions.postedAt, new Date(f.to + 'T23:59:59')));
  if (f.category === 'none') w.push(isNull(transactions.categoryId));
  else if (UUID.test(f.category)) w.push(eq(transactions.categoryId, f.category));
  if (f.merchant) w.push(eq(transactions.normalizedKey, f.merchant));
  if (f.settled) w.push(eq(transactions.pending, false));
  if (f.flow === 'paid') w.push(paidSide());
  else if (f.flow) w.push(cashFlowScope(), f.flow === 'out' ? spendingSide() : incomeSide());
  if (f.review) w.push(toReview() as SQL);
  return w.length ? (and(...w) as SQL) : undefined;
}

/**
 * A split parent that has its parts: left out of every count and total,
 * because its parts carry the same money. The list still draws the parent
 * with its parts indented under it; only the arithmetic skips it. Without
 * this, searching "Home Depot" read one $141.36 purchase as 4 transactions
 * and $282.72.
 *
 * The outer column is written out as "transactions"."id" on purpose: Drizzle
 * can emit an interpolated outer column unqualified inside a raw subquery,
 * where it resolves to the inner table and matches every row.
 */
/**
 * Payments a card (or loan) received: the incoming leg of a transfer. Wealth's
 * "Paid this month" and its drill-down (`flow=paid`) both read this, so the
 * figure and its list cannot disagree. Pending and excluded rows are left out
 * as they are from every cash-flow figure.
 */
export const paidSide = () =>
  and(
    eq(transactions.isTransfer, true),
    sql`${transactions.amount} > 0`,
    eq(transactions.pending, false),
    eq(transactions.excluded, false)
  ) as SQL;

const notSplitParent = () =>
  sql`not exists (select 1 from transactions c where c.split_parent_id = "transactions"."id")`;

export interface FeedRow {
  id: string;
  postedAt: string;
  merchant: string;
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  isTransfer: boolean;
  pending: boolean;
  excluded: boolean;
  unreviewed: boolean;
  splitCount?: number;
  splitPart?: boolean;
  parentId?: string | null;
}

const rowCols = {
  id: transactions.id,
  postedAt: transactions.postedAt,
  amount: transactions.amount,
  merchantName: transactions.merchantName,
  description: transactions.description,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categoryIcon: categories.icon,
  isTransfer: transactions.isTransfer,
  pending: transactions.pending,
  excluded: transactions.excluded,
  reviewedAt: transactions.reviewedAt,
  splitParentId: transactions.splitParentId
};

type RawRow = {
  id: string;
  postedAt: Date;
  amount: string;
  merchantName: string | null;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  isTransfer: boolean;
  pending: boolean;
  excluded: boolean;
  reviewedAt: Date | null;
  splitParentId: string | null;
};

const shape = (r: RawRow): FeedRow => ({
  id: r.id,
  postedAt: r.postedAt.toISOString(),
  merchant: cleanMerchant(r.merchantName || r.description),
  amount: Number(r.amount),
  categoryId: r.categoryId,
  categoryName: r.categoryName,
  categoryIcon: r.categoryIcon,
  isTransfer: r.isTransfer,
  pending: r.pending,
  excluded: r.excluded,
  unreviewed: !r.reviewedAt && !r.excluded,
  parentId: r.splitParentId
});

/**
 * The feed: newest first, `limit` rows. A split part is listed under its
 * parent rather than on its own; a filter that matches a part but not its
 * parent (category = Gifts) still shows the part, flagged as one.
 */
export async function feed(f: FeedFilters, limit: number) {
  const where = feedWhere(f);
  const raw = await db
    .select(rowCols)
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(where)
    .orderBy(desc(transactions.postedAt), desc(transactions.createdAt))
    .limit(limit + 1);
  const more = raw.length > limit;
  const rows = raw.slice(0, limit).map(shape);

  // Parts of the parents on screen, in their split order.
  const parentIds = rows.filter((r) => r.excluded).map((r) => r.id);
  const parts = parentIds.length
    ? (
        await db
          .select(rowCols)
          .from(transactions)
          .leftJoin(categories, eq(categories.id, transactions.categoryId))
          .where(inArray(transactions.splitParentId, parentIds))
          .orderBy(asc(transactions.providerTxnId))
      ).map(shape)
    : [];
  const byParent = new Map<string, FeedRow[]>();
  for (const p of parts) {
    const list = byParent.get(p.parentId!) ?? [];
    list.push({ ...p, splitPart: true });
    byParent.set(p.parentId!, list);
  }

  const out: FeedRow[] = [];
  const shown = new Set(parts.map((p) => p.id));
  for (const r of rows) {
    if (r.parentId && shown.has(r.id)) continue; // drawn under its parent
    const kids = byParent.get(r.id);
    if (kids) {
      out.push({ ...r, splitCount: kids.length, unreviewed: false });
      out.push(...kids);
    } else out.push(r.parentId ? { ...r, splitPart: true } : r);
  }

  const [count] = await db
    .select({ n: sql<number>`count(*)::int`, sum: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(where, notSplitParent()));
  return { rows: out, more, total: count?.n ?? 0, sum: Number(count?.sum ?? 0) };
}

/**
 * A figure opened inside an Advisor answer: its rows' count and
 * total -- the same filter, count and sum that head the Activity list it
 * links to, so the card can never disagree with that list -- the `top`
 * largest rows, and what the rest add up to.
 */
export async function drillSummary(f: FeedFilters, top = 4) {
  // Parts, never their parent: the card lists rows, and a parent beside its
  // own parts would be the same purchase twice.
  const where = and(feedWhere(f), notSplitParent());
  const [rows, [agg]] = await Promise.all([
    db
      .select(rowCols)
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(where)
      .orderBy(desc(sql`abs(${transactions.amount})`), desc(transactions.postedAt))
      .limit(top),
    db
      .select({ n: sql<number>`count(*)::int`, sum: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(where)
  ]);
  const shown = rows.map(shape);
  const total = Number(agg?.sum ?? 0);
  const count = agg?.n ?? 0;
  const shownSum = shown.reduce((s, r) => s + r.amount, 0);

  // "DINING OUT · SEPTEMBER": what the rows are, then when.
  let what = f.flow === 'in' ? 'Money in' : f.flow === 'out' ? 'Spending' : f.flow === 'paid' ? 'Payments' : 'Transactions';
  if (UUID.test(f.category)) {
    const [c] = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, f.category));
    if (c) what = c.name;
  } else if (f.category === 'none') what = 'Uncategorized';
  else if (f.merchant) what = shown[0]?.merchant ?? what;
  return {
    label: [what, rangeLabel(f.from, f.to)].filter(Boolean).join(' · '),
    flow: f.flow,
    count,
    total,
    rows: shown.map((r) => ({ id: r.id, merchant: r.merchant, postedAt: r.postedAt, amount: r.amount })),
    rest: { count: Math.max(0, count - shown.length), total: total - shownSum }
  };
}

/** "September" for a whole month, else "Sep 3 – Oct 2"; '' for no range. */
function rangeLabel(from: string, to: string): string {
  if (!from && !to) return '';
  const d = (s: string) => new Date(s + 'T12:00:00');
  const short = (s: string) => d(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (from && to) {
    const a = d(from);
    const end = new Date(a.getFullYear(), a.getMonth() + 1, 0).toLocaleDateString('en-CA');
    if (from.endsWith('-01') && to === end) return a.toLocaleDateString('en-US', { month: 'long' });
    return `${short(from)} – ${short(to)}`;
  }
  return from ? `Since ${short(from)}` : `Through ${short(to)}`;
}

/** Counts for the filter chips, under the other filters. */
export async function reviewCount(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(transactions).where(toReview());
  return r?.n ?? 0;
}

// ---- in/out by month -------------------------------------------------------

export interface MonthBar {
  /** YYYY-MM */
  month: string;
  label: string;
  income: number;
  spending: number;
  inHref: string;
  outHref: string;
  from: string;
  to: string;
}

const iso = (d: Date) => d.toLocaleDateString('en-CA');

function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
}

/** Income and spending per month, oldest first, through the cash-flow scope. */
export async function monthBars(months: number): Promise<MonthBar[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const rows = await db
    .select({
      month: sql<string>`to_char(${transactions.postedAt} at time zone current_setting('TimeZone'), 'YYYY-MM')`,
      income: sql<string>`coalesce(sum(case when ${incomeSide()} then ${transactions.amount} else 0 end), 0)`,
      spending: sql<string>`coalesce(sum(case when ${spendingSide()} then -${transactions.amount} else 0 end), 0)`
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(cashFlowScope(), gte(transactions.postedAt, start)))
    .groupBy(sql`1`);
  const by = new Map(rows.map((r) => [r.month, r]));
  const out: MonthBar[] = [];
  for (let k = 0; k < months; k++) {
    const d = new Date(start.getFullYear(), start.getMonth() + k, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const r = by.get(ym);
    const { from, to } = monthRange(ym);
    out.push({
      month: ym,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      income: Number(r?.income ?? 0),
      spending: Number(r?.spending ?? 0),
      inHref: drillHref({ from, to, flow: 'in' }),
      outHref: drillHref({ from, to, flow: 'out' }),
      from,
      to
    });
  }
  return out;
}

/** "September in review": in, out, kept and the top three categories. */
export async function monthSummary(ym: string) {
  const { from, to } = monthRange(ym);
  const fromD = new Date(from + 'T00:00:00');
  const toD = new Date(to + 'T23:59:59');
  const [tot] = await db
    .select({
      income: sql<string>`coalesce(sum(case when ${incomeSide()} then ${transactions.amount} else 0 end), 0)`,
      spending: sql<string>`coalesce(sum(case when ${spendingSide()} then -${transactions.amount} else 0 end), 0)`
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(cashFlowScope(), gte(transactions.postedAt, fromD), lte(transactions.postedAt, toD)));
  const top = await db
    .select({
      id: transactions.categoryId,
      name: categories.name,
      icon: categories.icon,
      spent: sql<string>`sum(-${transactions.amount})`
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(cashFlowScope(), spendingSide(), gte(transactions.postedAt, fromD), lte(transactions.postedAt, toD)))
    .groupBy(transactions.categoryId, categories.name, categories.icon)
    .orderBy(sql`4 desc`)
    .limit(3);
  const income = Number(tot?.income ?? 0);
  const spending = Number(tot?.spending ?? 0);
  return {
    month: ym,
    label: new Date(from + 'T12:00:00').toLocaleDateString('en-US', { month: 'long' }),
    income,
    spending,
    kept: income - spending,
    inHref: drillHref({ from, to, flow: 'in' }),
    outHref: drillHref({ from, to, flow: 'out' }),
    top: top.map((c) => ({
      name: c.name ?? 'Uncategorized',
      icon: c.icon,
      spent: Number(c.spent),
      href: drillHref({ category: c.id, from, to, flow: 'out' })
    }))
  };
}

// ---- where it went -----------------------------------------------------------

export interface WentRow {
  key: string;
  name: string;
  icon: string | null;
  uncategorized: boolean;
  spent: number;
  /** Against the previous window of the same length; null when not shown. */
  change: number | null;
  href: string;
}

/** A change worth a second line: at least $20 and 5% of what it was. */
const MIN_CHANGE = 20;
const MIN_CHANGE_SHARE = 0.05;

async function spentByCategory(from: string, to: string) {
  return db
    .select({
      id: transactions.categoryId,
      name: categories.name,
      icon: categories.icon,
      spent: sql<string>`sum(-${transactions.amount})`
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        cashFlowScope(),
        spendingSide(),
        gte(transactions.postedAt, new Date(from + 'T00:00:00')),
        lte(transactions.postedAt, new Date(to + 'T23:59:59'))
      )
    )
    .groupBy(transactions.categoryId, categories.name, categories.icon);
}

/**
 * "Where it went": every spending category in a window, largest
 * first, through the same scope as the hero's "out", so the rows sum to it.
 * `prev` is the window before, of the same length; it is only compared when
 * the ledger reaches back to its start, since a window from before the first
 * sync would make every category look like it grew.
 */
export async function whereItWent(
  win: { from: string; to: string },
  prev: { from: string; to: string }
): Promise<{ rows: WentRow[]; total: number; since: string | null; compared: boolean }> {
  const [now, before, [first]] = await Promise.all([
    spentByCategory(win.from, win.to),
    spentByCategory(prev.from, prev.to),
    // The first spending row, not the first row: a loan's own history can
    // reach back years before the card and checking feeds do.
    db
      .select({ at: sql<string | null>`min(${transactions.postedAt})` })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(and(cashFlowScope(), spendingSide()))
  ]);
  const firstDay = first?.at ? new Date(first.at).toLocaleDateString('en-CA') : null;
  const since = firstDay && firstDay > win.from ? firstDay : null;
  const compared = !!firstDay && firstDay <= prev.from;
  const was = new Map(before.map((r) => [r.id ?? 'none', Number(r.spent)]));

  const rows = now
    .map((r) => {
      const spent = Number(r.spent);
      const old = was.get(r.id ?? 'none') ?? 0;
      const delta = spent - old;
      const real = Math.abs(delta) >= MIN_CHANGE && (old === 0 || Math.abs(delta) / old >= MIN_CHANGE_SHARE);
      return {
        key: r.id ?? 'none',
        name: r.name ?? 'Uncategorized',
        icon: r.icon,
        uncategorized: !r.id || r.name === 'Uncategorized',
        spent,
        change: compared && real ? delta : null,
        href: drillHref({ category: r.id, from: win.from, to: win.to, flow: 'out' })
      };
    })
    .sort((a, b) => b.spent - a.spent);
  return { rows, total: rows.reduce((s, r) => s + r.spent, 0), since, compared };
}

// ---- one transaction ---------------------------------------------------------

export async function detail(id: string, holder: string | null) {
  if (!UUID.test(id)) return null;
  const [t] = await db
    .select({
      ...rowCols,
      normalizedKey: transactions.normalizedKey,
      note: transactions.note,
      transactedAt: transactions.transactedAt,
      accountId: accounts.id,
      accountName: accounts.name,
      accountNickname: accounts.nickname,
      orgName: accounts.orgName,
      provider: transactions.provider
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.id, id));
  if (!t) return null;

  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const tenAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 9, 1);
  // A visit is a purchase: split parts are shares of one, and a split parent
  // (excluded so its parts count in rollups) is still the visit itself.
  const splitParents = (
    await db
      .selectDistinct({ id: transactions.splitParentId })
      .from(transactions)
      .where(and(eq(transactions.normalizedKey, t.normalizedKey), sql`${transactions.splitParentId} is not null`))
  ).map((r) => r.id!);
  const sameMerchant = and(
    eq(transactions.normalizedKey, t.normalizedKey),
    ne(transactions.provider, 'split'),
    eq(transactions.isTransfer, false),
    splitParents.length
      ? or(eq(transactions.excluded, false), inArray(transactions.id, splitParents))
      : eq(transactions.excluded, false)
  );
  const [year] = await db
    .select({ n: sql<number>`count(*)::int`, sum: sql<string>`coalesce(sum(-${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(sameMerchant, gte(transactions.postedAt, yearStart)));
  const months = await db
    .select({
      month: sql<string>`to_char(${transactions.postedAt} at time zone current_setting('TimeZone'), 'YYYY-MM')`,
      sum: sql<string>`sum(-${transactions.amount})`
    })
    .from(transactions)
    .where(and(sameMerchant, gte(transactions.postedAt, tenAgo)))
    .groupBy(sql`1`);
  const byMonth = new Map(months.map((m) => [m.month, Number(m.sum)]));
  const strip = Array.from({ length: 10 }, (_, k) => {
    const d = new Date(tenAgo.getFullYear(), tenAgo.getMonth() + k, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { month: ym, label: d.toLocaleDateString('en-US', { month: 'short' }), total: byMonth.get(ym) ?? 0 };
  });

  // What "Always use for …" would also change: past rows of this merchant the
  // person has not set by hand.
  const [past] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.normalizedKey, t.normalizedKey),
        ne(transactions.categorySource, 'user'),
        eq(transactions.isTransfer, false),
        ne(transactions.id, t.id)
      )
    );

  const parts = t.excluded
    ? (
        await db
          .select(rowCols)
          .from(transactions)
          .leftJoin(categories, eq(categories.id, transactions.categoryId))
          .where(eq(transactions.splitParentId, t.id))
          .orderBy(asc(transactions.providerTxnId))
      ).map(shape)
    : [];

  // The recurring series this charge belongs to, if any: "Repeats monthly".
  const [series] = await db
    .select({ id: recurringSeries.id, cadenceDays: recurringSeries.cadenceDays, status: recurringSeries.status })
    .from(recurringSeries)
    .where(
      and(
        eq(recurringSeries.normalizedKey, t.normalizedKey),
        eq(recurringSeries.accountId, t.accountId),
        inArray(recurringSeries.status, ['active', 'suspected'])
      )
    )
    .limit(1);

  const merchant = cleanMerchant(t.merchantName || t.description);
  const when = t.transactedAt ?? t.postedAt;
  return {
    ...shape(t),
    merchant,
    key: t.normalizedKey,
    note: t.note ?? '',
    when: when.toISOString(),
    // SimpleFIN sends dates, not times: midnight means "no time known".
    hasTime: !((when.getHours() === 0 || when.getHours() === 12) && when.getMinutes() === 0),
    account: {
      id: t.accountId,
      name: accountDisplayName({ name: t.accountName, nickname: t.accountNickname, orgName: t.orgName }, holder),
      last4: lastFour(t.accountName)
    },
    bankSays: t.description,
    isPart: t.provider === 'split',
    parentId: t.splitParentId,
    parts,
    year: {
      count: year?.n ?? 0,
      total: Number(year?.sum ?? 0),
      href: drillHref({ merchant: t.normalizedKey, from: iso(yearStart), to: iso(new Date()) })
    },
    strip,
    stripHref: drillHref({ merchant: t.normalizedKey, from: iso(tenAgo) }),
    pastCount: past?.n ?? 0,
    recurring: series ? { id: series.id, cadenceDays: series.cadenceDays, suspected: series.status === 'suspected' } : null
  };
}

export type Detail = NonNullable<Awaited<ReturnType<typeof detail>>>;

/** Categories for the picker, most used first. Two plain queries joined in
 *  memory: a correlated subquery in a `sql` template can render the outer
 *  column unqualified and compare a table with itself. */
export async function pickerCategories() {
  const [cats, used] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name, icon: categories.icon, group: categories.group })
      .from(categories)
      .orderBy(categories.sortOrder, categories.name),
    db
      .select({ id: transactions.categoryId, n: sql<number>`count(*)::int` })
      .from(transactions)
      .groupBy(transactions.categoryId)
  ]);
  const n = new Map(used.map((u) => [u.id, u.n]));
  return cats
    .filter((c) => c.group !== 'transfer' && c.name !== 'Uncategorized')
    .map((c) => ({ ...c, used: n.get(c.id) ?? 0 }))
    .sort((a, b) => b.used - a.used);
}

// ---- writes ------------------------------------------------------------------

/**
 * Sets a category. `always` makes it a rule for the merchant and files its
 * past rows too ("Always use for Home Depot"); without it only this row
 * changes (the merchant memory still learns, as every correction does).
 */
export async function setCategory(id: string, categoryId: string, always: boolean) {
  if (!UUID.test(id) || !UUID.test(categoryId)) return;
  const [t] = await db
    .select({ key: transactions.normalizedKey, merchantName: transactions.merchantName, description: transactions.description })
    .from(transactions)
    .where(eq(transactions.id, id));
  if (!t) return;
  await applyUserCategory(id, categoryId, { propagate: always });
  if (always) {
    const name = cleanMerchant(t.merchantName || t.description);
    const [existing] = await db
      .select({ id: rules.id })
      .from(rules)
      .where(and(eq(rules.matchField, 'normalized'), eq(rules.matchType, 'equals'), eq(rules.matchValue, t.key)));
    if (existing) await db.update(rules).set({ setCategoryId: categoryId, enabled: true }).where(eq(rules.id, existing.id));
    else
      await db.insert(rules).values({
        name: `Always ${name}`,
        matchField: 'normalized',
        matchType: 'equals',
        matchValue: t.key,
        setCategoryId: categoryId
      });
  }
}

export async function setNote(id: string, note: string) {
  if (!UUID.test(id)) return;
  await db
    .update(transactions)
    .set({ note: note.trim() ? note.trim().slice(0, 500) : null, updatedAt: new Date() })
    .where(eq(transactions.id, id));
}

/** "Hide": kept out of every total, the row still listed. Not for split parents,
 *  whose exclusion is what makes their parts count. */
export async function setHidden(id: string, hidden: boolean) {
  if (!UUID.test(id)) return;
  await db
    .update(transactions)
    .set({ excluded: hidden, reviewedAt: new Date(), needsReview: false, updatedAt: new Date() })
    .where(and(eq(transactions.id, id), sql`not exists (select 1 from ${transactions} p where p.split_parent_id = ${id})`));
}

export interface SplitPart {
  categoryId: string | null;
  /** Positive, in dollars. */
  amount: number;
}

/**
 * Splits a posted row into parts that sum to it exactly. Amounts are checked
 * in cents; a remainder refuses the split rather than inventing a part.
 */
export async function split(id: string, parts: SplitPart[]): Promise<string | null> {
  if (!UUID.test(id)) return 'No such transaction.';
  const [t] = await db.select().from(transactions).where(eq(transactions.id, id));
  if (!t) return 'No such transaction.';
  if (t.pending) return 'Split it once it posts.';
  if (t.provider === 'split') return 'A part cannot be split again.';
  if (t.isTransfer) return 'A transfer cannot be split.';
  if (parts.length < 2) return 'A split needs at least two parts.';
  const total = Math.round(Math.abs(Number(t.amount)) * 100);
  const cents = parts.map((p) => Math.round(p.amount * 100));
  if (cents.some((c) => c <= 0)) return 'Every part needs an amount.';
  if (cents.reduce((s, c) => s + c, 0) !== total) return 'The parts must add up to the total.';
  if (parts.some((p) => !p.categoryId || !UUID.test(p.categoryId))) return 'Every part needs a category.';

  const sign = Number(t.amount) < 0 ? -1 : 1;
  await db.delete(transactions).where(eq(transactions.splitParentId, id));
  await db.insert(transactions).values(
    parts.map((p, i) => ({
      accountId: t.accountId,
      provider: 'split',
      providerTxnId: `split:${id}:${String(i + 1).padStart(2, '0')}`,
      postedAt: t.postedAt,
      transactedAt: t.transactedAt,
      amount: ((sign * cents[i]) / 100).toFixed(2),
      description: t.description,
      payee: t.payee,
      normalizedKey: t.normalizedKey,
      merchantName: t.merchantName,
      merchantId: t.merchantId,
      categoryId: p.categoryId,
      categorySource: 'user' as const,
      categoryConfidence: 1,
      pending: false,
      reviewedAt: new Date(),
      splitParentId: id
    }))
  );
  await db
    .update(transactions)
    .set({ excluded: true, reviewedAt: new Date(), needsReview: false, updatedAt: new Date() })
    .where(eq(transactions.id, id));
  return null;
}

export async function unsplit(id: string) {
  if (!UUID.test(id)) return;
  const gone = await db.delete(transactions).where(eq(transactions.splitParentId, id)).returning({ id: transactions.id });
  if (gone.length)
    await db.update(transactions).set({ excluded: false, updatedAt: new Date() }).where(eq(transactions.id, id));
}

export async function accountOptions(holder: string | null) {
  const rows = await db
    .select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname, orgName: accounts.orgName })
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .orderBy(accounts.name);
  return rows.map((a) => ({ id: a.id, name: accountDisplayName(a, holder) }));
}

