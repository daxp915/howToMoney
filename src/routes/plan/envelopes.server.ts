import { fail } from '@sveltejs/kit';
import { setBudget } from '$lib/server/budgets';
import { missedBills, monthEvents, planMonth } from '$lib/server/plan';
import type { Actions } from './$types';

/**
 * Envelopes and Recurring share one load: on desktop the calendar
 * sits beside the envelopes, on a phone they are two segments of the same
 * data. Everything comes from $lib/server/plan, the month model Home uses too.
 */
export const loadEnvelopes = async () => {
  const now = new Date();
  const [plan, events, missed] = await Promise.all([planMonth(now), monthEvents(now), missedBills()]);
  const today = now.toLocaleDateString('en-CA');
  return {
    plan,
    events,
    today,
    missed,
    calendar: {
      out: events.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0),
      in: events.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0),
      // Next up: what is still due, and what was paid in the last few days.
      next: events
        .filter((e) => e.date >= today || (e.paid && e.date >= today.slice(0, 8) + '01'))
        .filter((e) => !e.paid || e.date >= new Date(now.getTime() - 3 * 864e5).toLocaleDateString('en-CA'))
        .slice(0, 8)
    }
  };
};

export const envelopeActions: Actions = {
  /** A category's monthly budget, edited on its Plan row. Blank or 0 clears it. */
  set: async ({ request }) => {
    const form = await request.formData();
    const categoryId = String(form.get('categoryId') ?? '');
    const raw = String(form.get('amount') ?? '').replace(/[$,\s]/g, '');
    if (!categoryId) return fail(400, { message: 'Missing category.' });
    const amount = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      return fail(400, { message: 'Enter a positive number, or blank to clear.' });
    }
    await setBudget(categoryId, amount, null);
    return { success: true };
  }
};
