import { fail } from '@sveltejs/kit';
import { checkupSummary } from '$lib/server/advisor/facts';
import { goalGlance, payday, repeating, topPlaces, worth } from '$lib/server/home';
import { getPreferences } from '$lib/server/preferences';
import { homeCards } from '$lib/preferences';
import { drillHref } from '$lib/drill';
import { missedBills, monthEvents, planMonth, upcoming } from '$lib/server/plan';
import { markReviewed, reviewInbox } from '$lib/server/review';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

/**
 * Home answers one question: am I okay this month? The hero is
 * what is left of the budget and the pace chart; under it the rows nobody has
 * reviewed yet; beside it the budgets to watch, what is due this week, and one
 * Advisor finding. Net worth moved to Wealth; the recent list was Activity
 * twice over.
 *
 * Everything under the hero is a card the person can switch off, and a few
 * more can be switched on (`HOME_CARDS`). A card that is off costs nothing:
 * its query does not run.
 */
export const load: PageServerLoad = async ({ parent, locals }) => {
  const { hasAccounts } = await parent();
  if (!hasAccounts) return { empty: true as const };

  const prefs = await getPreferences();
  const on = homeCards(prefs.hiddenCards, prefs.dashboardCards);
  const want = <T>(id: string, f: () => Promise<T>) => (on.has(id) ? f() : Promise.resolve(null));
  const now = new Date();
  // Awaited, not streamed: every query runs inside the request's transaction
  // (hooks.server.ts), and a promise still running when the load returns
  // would be querying a transaction that has already committed -- the page
  // then never finishes loading.
  // Last month's plan for the "You kept $636" card: the same month
  // model, so its budgeted and spent are what Plan said at the time.
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const [plan, prev, events, inbox, advisor, worthNow, repeat, goals, places, missed] = await Promise.all([
    planMonth(now),
    want('kept', () => planMonth(lastMonth)),
    monthEvents(now),
    want('review', () => reviewInbox(6)),
    prefs.hiddenTabs.includes('/advisor') ? null : want('finding', () => checkupSummary().catch(() => null)),
    want('worth', () => worth()),
    want('repeating', () => repeating()),
    want('goals', () => goalGlance()),
    want('places', () => topPlaces(now)),
    want('upcoming', () => missedBills())
  ]);
  const pay = on.has('payday') ? await payday(events, now) : null;

  // Watch and over first, then the fullest; four is what fits beside the hero.
  const rank = (c: { spent: number; budget: number }) => {
    const r = c.budget > 0 ? c.spent / c.budget : 0;
    return r > 1 ? 3 + r : r > 0.85 ? 2 + r : r;
  };
  const budgets = !on.has('budgets') ? [] : [...plan.everyday].sort((a, b) => rank(b) - rank(a)).slice(0, 4);

  return {
    empty: false as const,
    month: {
      label: plan.label,
      day: plan.day,
      days: plan.days,
      short: new Date(plan.from + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })
    },
    budgeted: plan.budgeted,
    spent: plan.spent,
    spentHref: plan.spentHref,
    pace: plan.pace,
    hasBills: plan.bills.length > 0,
    budgets,
    // How last month ended against its budget. It used to show only a month
    // that came in under, so for anyone over budget the card -- and its
    // switch in Customize Home -- did nothing at all.
    kept:
      prev && (prev.budgeted > 0 || prev.spent > 0)
        ? { label: prev.label, budgeted: prev.budgeted, spent: prev.spent, href: prev.spentHref }
        : null,
    upcoming: on.has('upcoming') ? upcoming(events, now, 7).slice(0, 4) : [],
    // Recurring charges that did not come when expected: "may have stopped".
    missed: (missed ?? []).slice(0, 2),
    inbox,
    advisor,
    cards: [...on],
    payday: pay,
    worth: worthNow,
    flow: on.has('flow')
      ? {
          income: plan.income.received,
          incomeHref: plan.income.href,
          spent: plan.spent,
          spentHref: plan.spentHref,
          monthHref: drillHref({ from: plan.from, to: plan.to }),
          // "Ahead" or "short" waits for the month's first paycheck:
          // on day 6, before payday, every month reads short. With no
          // paycheck pattern at all there is nothing to wait for.
          payDay: (() => {
            if (events.some((e) => e.kind === 'pay' && e.paid)) return null;
            const next = events.find((e) => e.kind === 'pay' && !e.paid);
            return next ? Number(next.date.slice(8, 10)) : null;
          })()
        }
      : null,
    repeating: repeat,
    goals,
    places,
    askPmf: await pmfDue(locals.user!.id, now)
  };
};

/** The beta's day-30 question: asked once, 30 days after the account began. */
async function pmfDue(userId: string, now: Date): Promise<boolean> {
  const [me] = await db
    .select({ createdAt: users.createdAt, answer: users.pmfAnswer })
    .from(users)
    .where(eq(users.id, userId));
  return !!me && !me.answer && now.getTime() - me.createdAt.getTime() >= 30 * 864e5;
}

export const actions: Actions = {
  /** "Mark N as reviewed": every row the inbox was showing. */
  reviewed: async ({ request }) => {
    const form = await request.formData();
    const ids = form.getAll('id').map(String);
    if (!ids.length) return fail(400, { message: 'Nothing to mark.' });
    const n = await markReviewed(ids);
    return { reviewed: n };
  },

  /** The day-30 question's answer, or 'skipped'. Asked once either way. */
  pmf: async ({ request, locals }) => {
    const answer = String((await request.formData()).get('answer') ?? '');
    if (!['very', 'somewhat', 'not', 'skipped'].includes(answer)) return fail(400, { message: 'Pick one.' });
    await db.update(users).set({ pmfAnswer: answer, pmfAnsweredAt: new Date() }).where(eq(users.id, locals.user!.id));
    return { pmfAnswered: answer };
  }
};
