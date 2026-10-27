import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { accounts, goals } from './db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A pace needs a baseline long enough to mean something. Two weeks is the
 * shortest window that survives one paycheque landing early: below it, a goal
 * created yesterday would project a completion date from a single deposit and
 * confidently promise a house by Thursday.
 */
const MIN_PACE_DAYS = 14;

export interface GoalRow {
  id: string;
  name: string;
  note: string | null;
  status: string;
  accountId: string | null;
  accountName: string | null;
  /** 'save' when the target is above the starting point, 'payoff' when below. */
  direction: 'save' | 'payoff';
  target: number;
  starting: number;
  current: number;
  /** 0..1, clamped. */
  progress: number;
  /** Distance still to cover, always positive. */
  remaining: number;
  achieved: boolean;
  targetDate: Date | null;
  daysLeft: number | null;
  /** What the target date demands from here on. */
  requiredPerMonth: number | null;
  /** What has actually been managed per month since the goal was created. */
  pacePerMonth: number | null;
  /** Where the current pace lands, if it holds. */
  projectedDate: Date | null;
  onTrack: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function describeGoal(
  goal: typeof goals.$inferSelect,
  accountBalance: number | null,
  accountName: string | null,
  now = new Date()
): GoalRow {
  const target = Number(goal.targetAmount);
  const starting = Number(goal.startingAmount);
  const current = goal.accountId ? (accountBalance ?? 0) : Number(goal.manualAmount ?? 0);

  // One span covers both shapes. Saving runs upward (1,000 → 10,000); a payoff
  // runs upward too, because debt is stored negative (-4,200 → 0). Sign of the
  // span is the only thing that differs, so the progress fraction is identical.
  const span = target - starting;
  // Starting in the red is what makes a goal a payoff. It only changes the
  // wording on the page; none of the arithmetic branches on it.
  const direction: 'save' | 'payoff' = starting < 0 ? 'payoff' : 'save';
  const progress = span === 0 ? 1 : clamp01((current - starting) / span);
  const remaining = Math.max(0, Math.abs(target - current));
  const achieved = span === 0 || (span > 0 ? current >= target : current <= target);

  const targetDate = goal.targetDate ? new Date(goal.targetDate) : null;
  const daysLeft = targetDate
    ? Math.round((targetDate.getTime() - now.getTime()) / DAY_MS)
    : null;
  const monthsLeft = daysLeft === null ? null : Math.max(daysLeft, 0) / 30.44;
  const requiredPerMonth =
    monthsLeft === null || achieved ? null : monthsLeft < 0.5 ? remaining : remaining / monthsLeft;

  const elapsedDays = Math.max(0, (now.getTime() - new Date(goal.createdAt).getTime()) / DAY_MS);
  // Ground covered *toward* the target. Moving the wrong way counts as zero
  // rather than as negative progress, so a bad month cannot project a date in
  // the past.
  const covered = span > 0 ? Math.max(0, current - starting) : Math.max(0, starting - current);
  let pacePerMonth: number | null = null;
  let projectedDate: Date | null = null;

  if (!achieved && elapsedDays >= MIN_PACE_DAYS && covered > 0) {
    pacePerMonth = (covered / elapsedDays) * 30.44;
    const daysToGo = remaining / (covered / elapsedDays);
    if (Number.isFinite(daysToGo) && daysToGo < 365 * 40) {
      projectedDate = new Date(now.getTime() + daysToGo * DAY_MS);
    }
  }

  // Null means "not enough evidence yet", which is a different thing from
  // "behind" and has to stay distinguishable on the page.
  let onTrack: boolean | null = null;
  if (achieved) onTrack = true;
  else if (targetDate && projectedDate) {
    onTrack = projectedDate.getTime() <= targetDate.getTime();
  }

  return {
    id: goal.id,
    name: goal.name,
    note: goal.note,
    status: goal.status,
    accountId: goal.accountId,
    accountName,
    direction,
    target,
    starting,
    current,
    progress,
    remaining,
    achieved,
    targetDate,
    daysLeft,
    requiredPerMonth,
    pacePerMonth,
    projectedDate,
    onTrack,
    createdAt: new Date(goal.createdAt),
    updatedAt: new Date(goal.updatedAt)
  };
}

export async function listGoals(now = new Date()): Promise<GoalRow[]> {
  // Two plain queries joined in memory rather than a correlated subquery: a
  // `sql` template can render an outer column unqualified and silently compare
  // a table against itself.
  const goalRows = await db.select().from(goals).orderBy(asc(goals.sortOrder), asc(goals.createdAt));
  const accountRows = await db.select().from(accounts);
  const byId = new Map(accountRows.map((a) => [a.id, a]));

  return goalRows.map((g) => {
    const account = g.accountId ? byId.get(g.accountId) : undefined;
    return describeGoal(
      g,
      account ? Number(account.balance ?? 0) : null,
      account ? (account.nickname ?? account.name) : null,
      now
    );
  });
}

/** Current value of an account, for snapshotting a new goal's starting point. */
export async function accountBalance(accountId: string): Promise<number> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  return Number(row?.balance ?? 0);
}
