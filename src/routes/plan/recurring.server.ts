import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { recurringSeries } from '$lib/server/db/schema';
import { detectRecurring } from '$lib/server/matching/recurring';
import { addManualBill, endSeries } from '$lib/server/recurringUser';
import { UUID } from '$lib/server/review';
import type { Actions } from './$types';

/** Recurring's data comes from loadEnvelopes (one month model); these are its
 *  writes: ignore a series that is not really recurring, or rescan. */
export const recurringActions: Actions = {
  setStatus: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const status = String(form.get('status') ?? '');
    if (!id || !['active', 'ignored'].includes(status)) {
      return fail(400, { message: 'Bad request.' });
    }
    await db.update(recurringSeries).set({ status, updatedAt: new Date() }).where(eq(recurringSeries.id, id));
    return { success: true };
  },

  /** "Add a recurring bill": one the bank feed will never show. */
  addBill: async ({ request }) => {
    const form = await request.formData();
    const category = String(form.get('categoryId') ?? '');
    const err = await addManualBill({
      name: String(form.get('name') ?? ''),
      amount: Number(String(form.get('amount') ?? '').replace(/[$,\s]/g, '')),
      cadenceDays: Number(form.get('cadence')),
      nextDue: String(form.get('nextDue') ?? ''),
      categoryId: UUID.test(category) ? category : null
    });
    if (err) return fail(400, { addBill: err });
    return { billAdded: true };
  },

  /** "It stopped": a late charge the person says is not coming back. */
  endSeries: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!UUID.test(id)) return fail(400, { message: 'Bad request.' });
    await endSeries(id);
    return { ended: true };
  },

  rescan: async () => {
    const result = await detectRecurring();
    return { success: true, ...result };
  }
};
