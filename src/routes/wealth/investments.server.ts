import { and, asc, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accountBalances, accounts, holdingSnapshots, transactions } from '$lib/server/db/schema';
import { assetClass } from '$lib/assetClass';
import {
  PERIODS,
  classifyFlow,
  fundName,
  isAutomatic,
  isDividend,
  periodResult,
  periodStart,
  type Period
} from '$lib/investmentFlow';

/**
 * One brokerage account's detail in Wealth (v2 folded the Investments tab into
 * /wealth/[accountId]; the rebuild on the v2 panel comes later). Per handoff 6a-6b: how the money got to what it is worth now,
 * split into what was already there, what was put in, and what the market
 * added.
 *
 * - **Balances** come from the daily snapshots (`account_balances`) -- a
 *   brokerage's worth moves without a transaction, so no ledger walk-back
 *   can reproduce it. A period that starts before the first snapshot starts
 *   at the first snapshot instead, and the page says so ("since Sep 20")
 *   rather than pretending to know January's balance.
 * - **Put in** comes from the ledger, row by row through `classifyFlow()`:
 *   contributions, rollovers and transfers in count; the broker's own sweeps
 *   and buys inside the account do not, or one contribution would count three
 *   times.
 * - **Market added** is end - start - put in: dividends, interest and price
 *   moves together. **Return** is that over (start + half of put in).
 * - **Holdings** come from the newest `holding_snapshots` day; none means the
 *   provider sends none, and the two holdings cards are left out.
 */

const DAY = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const loadInvestments = async (url: URL, accountId: string) => {
  const asked = url.searchParams.get('p') ?? url.searchParams.get('period');
  const period: Period = PERIODS.some((p) => p.key === asked) ? (asked as Period) : 'ytd';
  const today = isoDay(new Date());

  const accts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      nickname: accounts.nickname,
      orgName: accounts.orgName,
      balance: accounts.balance,
      lastSyncedAt: accounts.lastSyncedAt
    })
    .from(accounts)
    .where(
      and(eq(accounts.id, accountId), eq(accounts.type, 'investment'), eq(accounts.isActive, true))
    )
    .orderBy(asc(accounts.name));

  const empty = { period, accounts: [], syncedAt: null, hasData: false as const };
  if (!accts.length) return empty;
  const ids = accts.map((a) => a.id);
  const syncedAt =
    accts
      .map((a) => a.lastSyncedAt)
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const accountsOut = accts.map((a) => ({
    id: a.id,
    name: a.name,
    nickname: a.nickname,
    orgName: a.orgName
  }));

  // ---- balances: one total per day, each account carried forward ----------
  const balanceRows = await db
    .select({
      accountId: accountBalances.accountId,
      asOf: accountBalances.asOf,
      balance: accountBalances.balance
    })
    .from(accountBalances)
    .where(inArray(accountBalances.accountId, ids))
    .orderBy(asc(accountBalances.asOf));
  if (!balanceRows.length) return { ...empty, accounts: accountsOut, syncedAt };

  const byDay = new Map<string, Map<string, number>>();
  for (const r of balanceRows) {
    if (!byDay.has(r.asOf)) byDay.set(r.asOf, new Map());
    byDay.get(r.asOf)!.set(r.accountId, Number(r.balance));
  }
  const known = new Map<string, number>();
  const allDays = [...byDay.keys()].sort().map((day) => {
    for (const [id, v] of byDay.get(day)!) known.set(id, v);
    return { day, worth: [...known.values()].reduce((s, v) => s + v, 0) };
  });

  const firstDay = allDays[0].day;
  const wanted = periodStart(period, today);
  // The period cannot start before the history does.
  const startDay = wanted && wanted > firstDay ? wanted : firstDay;
  const clamped = wanted === null ? false : wanted < firstDay;
  // The balance the period starts from: the last known total on or before
  // its first day.
  const startIdx = Math.max(
    0,
    allDays.findLastIndex((d) => d.day <= startDay)
  );
  const days = allDays.slice(startIdx);
  const start = days[0].worth;
  const end = days[days.length - 1].worth;

  // ---- the ledger: what came in from outside ------------------------------
  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      postedAt: transactions.postedAt,
      amount: transactions.amount,
      description: transactions.description,
      isTransfer: transactions.isTransfer,
      transferGroupId: transactions.transferGroupId
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.accountId, ids),
        eq(transactions.pending, false),
        eq(transactions.excluded, false)
      )
    )
    .orderBy(desc(transactions.postedAt));

  const flows = rows
    .map((r) => ({
      ...r,
      day: isoDay(r.postedAt),
      value: Number(r.amount),
      flow: classifyFlow(r.description, Number(r.amount), r.isTransfer)
    }))
    .filter((r) => r.flow !== 'internal');

  // After the starting balance was taken, so the money is not counted twice.
  const inPeriod = flows.filter((r) => r.day > days[0].day && r.day <= today);
  const moved = inPeriod.filter((r) => r.flow === 'put-in' || r.flow === 'withdrawal');
  const putIn = moved.reduce((s, r) => s + r.value, 0);
  const dividends = inPeriod
    .filter((r) => r.flow === 'growth' && isDividend(r.description))
    .reduce((s, r) => s + r.value, 0);
  const result = periodResult(start, putIn, end);

  // "Put in each month": the automatic contributions of the last 90 days, or
  // every put-in averaged when none of them is automatic. Its own window,
  // independent of the pill, so a ten-day period is not multiplied up.
  const since90 = isoDay(new Date(Date.now() - 90 * DAY));
  const recent = flows.filter((r) => r.flow === 'put-in' && r.day > since90);
  const autoRecurring = recent.filter((r) => isAutomatic(r.description) || (r.isTransfer && sameAmountRepeats(recent, r.value)));
  const monthly = autoRecurring.length
    ? { amount: autoRecurring.reduce((s, r) => s + r.value, 0) / 3, automatic: true }
    : recent.length
      ? { amount: recent.reduce((s, r) => s + r.value, 0) / 3, automatic: false }
      : null;

  // The value line: sampled to about 120 points; the put-in line steps on
  // each contribution date.
  const every = Math.max(1, Math.ceil(days.length / 120));
  let cumulative = start;
  const steps = [...moved].sort((a, b) => a.day.localeCompare(b.day));
  let k = 0;
  const series = days
    .filter((_, i) => i % every === 0 || i === days.length - 1)
    .map((d) => {
      while (k < steps.length && steps[k].day <= d.day) cumulative += steps[k++].value;
      return { day: d.day, worth: d.worth, putIn: cumulative };
    });

  // ---- "Money in": the last inflows, named for where they came from -------
  const groups = [...new Set(inPeriod.map((r) => r.transferGroupId).filter((g): g is string => !!g))];
  const partners = groups.length
    ? await db
        .select({ groupId: transactions.transferGroupId, name: accounts.name, nickname: accounts.nickname, orgName: accounts.orgName })
        .from(transactions)
        .innerJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(and(inArray(transactions.transferGroupId, groups), isNotNull(transactions.transferGroupId), ne(accounts.type, 'investment')))
    : [];
  const partnerOf = new Map(partners.map((p) => [p.groupId!, p]));
  const reinvested = new Set(
    rows
      .filter((r) => /REINVEST/i.test(r.description) && Number(r.amount) < 0)
      .map((r) => `${r.accountId}|${isoDay(r.postedAt)}|${(-Number(r.amount)).toFixed(2)}`)
  );

  // ---- holdings: the newest day each account reported ---------------------
  const snaps = await db
    .select()
    .from(holdingSnapshots)
    .where(inArray(holdingSnapshots.accountId, ids))
    .orderBy(desc(holdingSnapshots.asOf));
  const newest = new Map<string, string>();
  for (const h of snaps) if (!newest.has(h.accountId)) newest.set(h.accountId, h.asOf);
  const current = snaps.filter((h) => newest.get(h.accountId) === h.asOf);

  // Merged by symbol across accounts: two accounts holding one fund is one
  // position. Cost is known only if every part of it reports one.
  const merged = new Map<
    string,
    { symbol: string | null; description: string | null; shares: number; value: number; cost: number | null }
  >();
  for (const h of current) {
    const key = h.symbol ?? h.holdingKey;
    const m = merged.get(key) ?? { symbol: h.symbol, description: h.description, shares: 0, value: 0, cost: 0 };
    const shares = Number(h.shares);
    m.shares += shares;
    m.value += Number(h.marketValue);
    m.cost = m.cost === null || h.purchasePrice === null ? null : m.cost + Number(h.purchasePrice) * shares;
    merged.set(key, m);
  }
  const holdingTotal = [...merged.values()].reduce((s, h) => s + h.value, 0);
  const holdings = [...merged.entries()]
    .map(([key, h]) => {
      const kind = assetClass(h.symbol, h.description);
      return {
        key,
        symbol: h.symbol,
        name: kind === 'cash' ? 'Cash' : fundName(h.description, h.symbol),
        kind,
        shares: h.shares,
        price: h.shares > 0 ? h.value / h.shares : 0,
        value: h.value,
        share: holdingTotal > 0 ? h.value / holdingTotal : 0,
        gain: kind === 'cash' || h.cost === null || h.cost === 0 ? null : h.value - h.cost,
        gainPct: kind === 'cash' || !h.cost ? null : (h.value - h.cost) / h.cost
      };
    })
    // By value, cash last.
    .sort((a, b) => (a.kind === 'cash' ? 1 : 0) - (b.kind === 'cash' ? 1 : 0) || b.value - a.value);

  // A dividend row names its fund in words; the holding with the longest
  // name found in it supplies the ticker.
  const tickerFor = (description: string) => {
    const d = description.toUpperCase();
    const direct = holdings.find((h) => h.symbol && new RegExp(`\\b${h.symbol}\\b`).test(d));
    if (direct) return direct.symbol;
    const byName = current
      .filter((h) => h.symbol && h.description && d.includes(h.description.toUpperCase().replace(/[®™]/g, '').trim()))
      .sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))[0];
    return byName?.symbol ?? null;
  };
  const acctName = new Map(accts.map((a) => [a.id, a]));

  const moneyIn = inPeriod
    .filter((r) => r.value > 0 && (r.flow === 'put-in' || r.flow === 'growth'))
    .slice(0, 5)
    .map((r) => {
      const growth = r.flow === 'growth';
      const partner = r.transferGroupId ? partnerOf.get(r.transferGroupId) : undefined;
      let title: string;
      let how: string;
      if (growth) {
        const kind = isDividend(r.description) ? 'Dividend' : /INTEREST/i.test(r.description) ? 'Interest' : 'Gain';
        const ticker = tickerFor(r.description);
        title = ticker ? `${kind} · ${ticker}` : kind;
        how = reinvested.has(`${r.accountId}|${r.day}|${r.value.toFixed(2)}`) ? 'Reinvested' : 'Paid';
      } else {
        // With a partner leg the page names it ("From Everyday Checking").
        title = /ROLLOVER/i.test(r.description)
            ? 'Rollover'
            : /CONTRIBUTION/i.test(r.description)
              ? 'Contribution'
              : 'Deposit';
        how = isAutomatic(r.description) || (r.isTransfer && sameAmountRepeats(recent, r.value)) ? 'Automatic' : 'One-off';
      }
      return {
        id: r.id,
        title,
        partner: partner ? { name: partner.name, nickname: partner.nickname, orgName: partner.orgName } : null,
        growth,
        how,
        day: r.day,
        amount: r.value,
        account: acctName.get(r.accountId)!
      };
    });

  return {
    period,
    accounts: accountsOut,
    syncedAt,
    hasData: true as const,
    worth: accts.reduce((s, a) => s + Number(a.balance ?? 0), 0),
    startDay: days[0].day,
    clamped: clamped || wanted === null,
    result,
    dividends,
    monthly,
    series,
    holdings,
    moneyIn
  };
};

/** A transfer that arrived at least twice for the same amount in the window
 *  is a standing order, not a one-off. */
function sameAmountRepeats(rows: { value: number }[], value: number): boolean {
  return rows.filter((r) => Math.abs(r.value - value) < 0.005).length >= 2;
}
