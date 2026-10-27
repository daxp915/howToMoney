/**
 * The numbers the validation plan asks of the beta, for the admin page:
 * who keeps coming back, what they answered at day 30, and what each one
 * costs to run.
 *
 * Cross-household by nature, so it reads through `systemDb` -- and returns
 * counts, dates and dollars of *running cost* only, never anyone's balances
 * or transactions (systemDb rows must never carry tenant money to a page).
 */
import { and, gte, sql } from 'drizzle-orm';
import { systemDb } from './db';
import { advisorTurns, plaidItems, providerCredentials, syncRuns, userActiveDays, users } from './db/schema';

const DAY = 864e5;
const WEEKS = 8;

/** Monday 00:00 UTC of the week holding `d`. */
function weekStart(d: Date): number {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return x.getTime() - ((x.getUTCDay() + 6) % 7) * DAY;
}

export async function betaMetrics(now = new Date()) {
  const since = new Date(weekStart(now) - (WEEKS - 1) * 7 * DAY);
  const month = new Date(now.getTime() - 30 * DAY);

  const [people, days, items, creds, advisorCost, syncCost] = await Promise.all([
    systemDb
      .select({ id: users.id, email: users.email, createdAt: users.createdAt, pmf: users.pmfAnswer })
      .from(users)
      .orderBy(users.createdAt),
    systemDb
      .select({ userId: userActiveDays.userId, day: userActiveDays.day })
      .from(userActiveDays)
      .where(gte(userActiveDays.day, since.toISOString().slice(0, 10))),
    systemDb.select({ userId: plaidItems.userId, n: sql<number>`count(*)::int` }).from(plaidItems).groupBy(plaidItems.userId),
    systemDb.select({ userId: providerCredentials.userId }).from(providerCredentials),
    systemDb
      .select({ userId: advisorTurns.userId, usd: sql<string>`coalesce(sum(${advisorTurns.costUsd}), 0)` })
      .from(advisorTurns)
      .where(gte(advisorTurns.createdAt, month))
      .groupBy(advisorTurns.userId),
    systemDb
      .select({ userId: syncRuns.userId, usd: sql<string>`coalesce(sum(${syncRuns.aiCostUsd}), 0)` })
      .from(syncRuns)
      .where(and(gte(syncRuns.startedAt, month)))
      .groupBy(syncRuns.userId)
  ]);

  // Plaid bills per connected bank per month; the rate is whatever Plaid
  // quotes (PLAID_COST_PER_ITEM, dollars). Unset = shown as bank counts only.
  const plaidRate = Number(process.env.PLAID_COST_PER_ITEM ?? '') || null;
  const weekKeys = Array.from({ length: WEEKS }, (_, i) => weekStart(new Date(since.getTime() + i * 7 * DAY)));
  const byUser = new Map<string, Set<string>>();
  for (const d of days) {
    const set = byUser.get(d.userId) ?? new Set<string>();
    set.add(d.day);
    byUser.set(d.userId, set);
  }
  const plaidBy = new Map(items.map((r) => [r.userId, r.n]));
  const simplefinBy = new Set(creds.map((r) => r.userId));
  const aiBy = new Map<string, number>();
  for (const r of [...advisorCost, ...syncCost]) aiBy.set(r.userId, (aiBy.get(r.userId) ?? 0) + Number(r.usd));

  const rows = people.map((p) => {
    const active = [...(byUser.get(p.id) ?? [])].map((d) => new Date(d + 'T00:00:00Z').getTime());
    const within = (ms: number) => active.filter((t) => t >= now.getTime() - ms).length;
    const banks = plaidBy.get(p.id) ?? 0;
    const ai = aiBy.get(p.id) ?? 0;
    return {
      id: p.id,
      email: p.email,
      joined: p.createdAt,
      days7: within(7 * DAY),
      days30: within(30 * DAY),
      weeks: weekKeys.map((w) => active.some((t) => t >= w && t < w + 7 * DAY)),
      plaidBanks: banks,
      simplefin: simplefinBy.has(p.id),
      aiUsd: ai,
      costUsd: plaidRate === null ? null : ai + banks * plaidRate,
      pmf: p.pmf
    };
  });

  const answered = rows.filter((r) => r.pmf && r.pmf !== 'skipped');
  return {
    rows,
    weekly: weekKeys.map((w, i) => ({
      week: new Date(w).toISOString().slice(0, 10),
      active: rows.filter((r) => r.weeks[i]).length
    })),
    pmf: {
      answered: answered.length,
      very: answered.filter((r) => r.pmf === 'very').length,
      somewhat: answered.filter((r) => r.pmf === 'somewhat').length,
      not: answered.filter((r) => r.pmf === 'not').length
    },
    plaidRate
  };
}
