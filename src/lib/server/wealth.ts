/**
 * Wealth: net worth over a period, and every account grouped Cash ·
 * Investments · Credit cards · Loans.
 *
 * The net-worth line is rebuilt per day. Cash, cards and loans walk back from
 * today's balances through the ledger (a transfer's two legs cancel). Split
 * parts are left out of the walk -- their parent row already moved the
 * balance. Investment accounts never walk back: their worth moves with the
 * market, leaving no transaction trail, so they come from the daily snapshots
 * (`account_balances`), carried forward, and held at the first snapshot
 * before it.
 */
import { and, asc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { db } from './db';
import { accountBalances, accounts, holdingSnapshots, transactions } from './db/schema';
import { listLoans, type Loan } from './loans';
import { accountDisplayName, institutionName, lastFour } from '../accountName';
import { periodStart, type Period } from '../investmentFlow';

export const WEALTH_PERIODS: { key: Period; label: string }[] = [
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1Y' },
  { key: 'all', label: 'All' }
];

const DAY = 864e5;
const iso = (d: Date) => d.toLocaleDateString('en-CA');

export function readPeriod(url: URL): Period {
  const p = url.searchParams.get('p');
  return WEALTH_PERIODS.some((x) => x.key === p) ? (p as Period) : 'ytd';
}

export interface WealthRow {
  id: string;
  name: string;
  type: string;
  balance: number;
  meta: string;
  paidOff: boolean;
}

/**
 * `focus` narrows the line to one account (an opened /wealth/<id>); the groups
 * and the net-worth total stay whole.
 */
export async function wealthOverview(period: Period, holder: string | null, focus: string | null = null) {
  const accts = await db.select().from(accounts).where(eq(accounts.isActive, true)).orderBy(asc(accounts.name));
  const loans = await listLoans();
  const loanBy = new Map(loans.map((l) => [l.id, l]));

  // Holdings per brokerage on its newest day, for "4 holdings".
  const invIds = accts.filter((a) => a.type === 'investment').map((a) => a.id);
  const snaps = invIds.length
    ? await db
        .select({ id: holdingSnapshots.accountId, day: holdingSnapshots.asOf, n: sql<number>`count(*)::int` })
        .from(holdingSnapshots)
        .where(inArray(holdingSnapshots.accountId, invIds))
        .groupBy(holdingSnapshots.accountId, holdingSnapshots.asOf)
    : [];
  const holdingCount = new Map<string, number>();
  const newest = new Map<string, string>();
  for (const s of snaps)
    if (!newest.has(s.id) || s.day > newest.get(s.id)!) {
      newest.set(s.id, s.day);
      holdingCount.set(s.id, s.n);
    }

  const monthYear = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  const rows: WealthRow[] = accts.map((a) => {
    const four = lastFour(a.name);
    const where = [institutionName(a.orgName), four ? `··${four}` : null].filter(Boolean).join(' ');
    const extra: string[] = [];
    let paidOff = false;
    if (a.type === 'investment' && holdingCount.get(a.id)) extra.push(`${holdingCount.get(a.id)} holdings`);
    if (a.type === 'loan') {
      const l = loanBy.get(a.id);
      paidOff = !!l?.paidOff;
      const end = l?.payoff?.date ?? l?.earliest?.date;
      if (!paidOff && end) extra.push(`paid off by ${monthYear(end)}`);
    }
    return {
      id: a.id,
      name: accountDisplayName(a, holder),
      type: a.type,
      balance: Number(a.balance ?? 0),
      meta: [where, ...extra].filter(Boolean).join(' · '),
      paidOff
    };
  });

  const GROUPS = [
    { key: 'cash', label: 'Cash', types: ['depository', 'other'] },
    { key: 'investments', label: 'Investments', types: ['investment'] },
    { key: 'credit', label: 'Credit cards', types: ['credit'] },
    { key: 'loans', label: 'Loans', types: ['loan'] }
  ];
  const groups = GROUPS.map((g) => {
    const list = rows.filter((r) => g.types.includes(r.type));
    return { key: g.key, label: g.label, rows: list, total: list.reduce((s, r) => s + r.balance, 0) };
  }).filter((g) => g.rows.length);

  const focused = focus ? rows.find((r) => r.id === focus) ?? null : null;
  const series = await netWorthSeries(
    period,
    focused ? accts.filter((a) => a.id === focused.id) : accts,
    !!focused
  );
  return {
    groups,
    series,
    worth: rows.reduce((s, r) => s + r.balance, 0),
    focus: focused ? { id: focused.id, name: focused.name, balance: focused.balance } : null
  };
}

/**
 * `single`: one account's line. A lone brokerage has no history before its
 * first snapshot, so its line starts there instead of holding that value flat
 * back to the period start -- in the whole line that flat stretch is a fair
 * stand-in, on its own it would be invented history.
 */
async function netWorthSeries(period: Period, accts: (typeof accounts.$inferSelect)[], single = false) {
  const today = iso(new Date());
  const [first] = await db.select({ at: sql<string | null>`min(${transactions.postedAt})::text` }).from(transactions);
  const firstDay = first?.at ? iso(new Date(first.at)) : today;
  const wanted = periodStart(period, today) ?? firstDay;
  const from = wanted < firstDay ? firstDay : wanted;
  const n = Math.max(
    2,
    Math.min(800, Math.round((new Date(today + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / DAY) + 1)
  );

  const flat = accts.filter((a) => a.type !== 'investment');
  const inv = accts.filter((a) => a.type === 'investment');

  const deltas = flat.length
    ? await db
        .select({
          day: sql<string>`to_char(${transactions.postedAt} at time zone current_setting('TimeZone'), 'YYYY-MM-DD')`,
          delta: sql<string>`sum(${transactions.amount})`
        })
        .from(transactions)
        .where(
          and(
            inArray(
              transactions.accountId,
              flat.map((a) => a.id)
            ),
            eq(transactions.pending, false),
            ne(transactions.provider, 'split'),
            gte(transactions.postedAt, new Date(from + 'T00:00:00'))
          )
        )
        .groupBy(sql`1`)
    : [];
  const deltaBy = new Map(deltas.map((d) => [d.day, Number(d.delta)]));

  const snaps = inv.length
    ? await db
        .select({ id: accountBalances.accountId, day: accountBalances.asOf, balance: accountBalances.balance })
        .from(accountBalances)
        .where(
          inArray(
            accountBalances.accountId,
            inv.map((a) => a.id)
          )
        )
        .orderBy(asc(accountBalances.asOf))
    : [];

  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(iso(new Date(Date.now() - i * DAY)));

  // Cash side, walked back from today's balances.
  let running = flat.reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const cash = new Map<string, number>();
  for (let i = days.length - 1; i >= 0; i--) {
    cash.set(days[i], running);
    running -= deltaBy.get(days[i]) ?? 0;
  }

  // Investment side, from snapshots carried forward.
  const bySnap = new Map<string, { day: string; balance: number }[]>();
  for (const x of snaps) {
    const list = bySnap.get(x.id) ?? [];
    list.push({ day: String(x.day), balance: Number(x.balance) });
    bySnap.set(x.id, list);
  }
  const invAt = (day: string) =>
    inv.reduce((s, a) => {
      const mine = bySnap.get(a.id);
      if (!mine?.length) return s + Number(a.balance ?? 0);
      let v = mine[0].balance;
      for (const m of mine) if (m.day <= day) v = m.balance;
      return s + v;
    }, 0);

  const every = Math.max(1, Math.ceil(days.length / 120));
  const firstSnap = single && inv.length ? (snaps.length ? String(snaps[0].day) : today) : null;
  const points = days
    .filter((_, i) => i % every === 0 || i === days.length - 1)
    .filter((d) => !firstSnap || d >= firstSnap)
    .map((d) => ({ day: d, value: (cash.get(d) ?? 0) + invAt(d) }));
  const start = points[0]?.value ?? 0;
  const end = points[points.length - 1]?.value ?? 0;
  return { points, from: firstSnap && firstSnap > from ? firstSnap : from, change: end - start };
}

/** A loan's detail: the loan and the others already paid off. */
export async function loanDetail(id: string): Promise<{ loan: Loan; paidOff: Loan[] } | null> {
  const loans = await listLoans();
  const loan = loans.find((l) => l.id === id);
  if (!loan) return null;
  return { loan, paidOff: loans.filter((l) => l.paidOff && l.id !== id) };
}
