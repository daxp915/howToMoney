import type { Fig } from './figures';
import type { CashEvent, ForecastPoint } from './forecast';

/**
 * The shape of a stored Advisor answer, shared by the server that writes it
 * (`$lib/server/advisor/agent.ts`) and the page that draws it. Every number
 * here is the app's: the model wrote only `prose`, `verdict.label`, the tile
 * labels and the follow-ups.
 */

export type Shape = 'afford' | 'debt' | 'goal' | 'cut' | 'invest' | 'missing' | 'general';

/** Something the data cannot show yet (7i "What's missing"). */
export interface Gap {
  key: 'paycheck' | 'history' | 'checking' | 'suspected';
  emoji: string;
  title: string;
  detail: string;
}

/**
 * A next step the answer offers (the model proposes it, the app resolves and
 * checks it): open Plan's new-goal form filled in, or set a category's
 * monthly budget in one click. `amount` is a figure the tools computed, never
 * one the model typed.
 */
export type AdvisorAction =
  | { kind: 'goal'; name: string; amount: number; date: string | null; why: string }
  | { kind: 'budget'; categoryId: string; category: string; amount: number; current: number | null; why: string };

/** Where a goal action opens: Plan's Goals tab with the new-goal form filled in. */
export function goalHref(a: { name: string; amount: number; date: string | null }): string {
  const q = new URLSearchParams({ tab: 'goals', new: 'save', name: a.name, target: String(Math.round(a.amount)) });
  if (a.date) q.set('date', a.date);
  return `/plan?${q}`;
}

/** A "What this rests on" tile. */
export interface Evidence {
  id: string;
  label: string;
  sub: string | null;
}

export interface Answer {
  verdict: { tone: 'yes' | 'wait' | 'no' | 'unknown'; label: string } | null;
  /** Verdict first, with `{{placeholders}}` for its figures. */
  prose: string;
  shape: Shape;
  evidence: Evidence[];
  /** Only the figures the answer uses. */
  figures: Record<string, Fig>;
  /** The structured result behind the shape's block; see the payload types. */
  payload: unknown;
  gaps: Gap[];
  followups: string[];
  /** Something the app can hold for them after this answer: a goal to set
   *  up, a budget to set. Absent on answers stored before actions existed. */
  actions?: AdvisorAction[];
  /** "Worked out from 90 days of Everyday Checking and 2 cards, through Sep 29." */
  basis: string;
}

/** 7b: checking with and without the purchase. */
export interface AffordPayload {
  verdict: 'now' | 'wait' | 'no';
  amount: number;
  floor: number;
  asked: string;
  buyDay: string | null;
  unlockedBy: CashEvent | null;
  lowest: ForecastPoint;
  what: string;
  account: string;
  without: ForecastPoint[];
  points: ForecastPoint[];
  events: CashEvent[];
}

/** 7e: a loan as it is, and with an extra payment. */
export interface DebtPayload {
  loan: string;
  owed: number;
  rate: { apr: number; source: 'entered' | 'estimated' };
  nextDue: string | null;
  extra: number;
  asIs: { payment: number; payments: number; interest: number; paidOff: string | null };
  withExtra: { payment: number; payments: number; interest: number; paidOff: string | null } | null;
}

/** 7f: one goal, drawn as the 2b card. */
export interface GoalPayload {
  name: string;
  account: string | null;
  target: number;
  current: number;
  progress: number;
  /** Where it should be today, 0..1, or null without a target date. */
  expected: number | null;
  targetDate: string | null;
  daysLeft: number | null;
  onTrack: boolean | null;
  extra: number;
  pace: number | null;
  doneAtPace: string | null;
  needed: number | null;
}

/** 7g: categories with room in them. */
export interface CutPayload {
  target: number | null;
  months: string[];
  topN: number;
  rows: Array<{
    name: string;
    icon: string | null;
    usual: number;
    usualHref: string | null;
    aim: number;
    aimHref: string | null;
    why: string;
    frees: number;
  }>;
}
