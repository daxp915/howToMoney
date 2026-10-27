import { fail } from '@sveltejs/kit';
import { setLoanName, setLoanRate } from '$lib/server/loans';
import type { Actions } from '@sveltejs/kit';

/** A loan's writes, from its Wealth detail: the rate typed in from a
 *  statement (blank goes back to the estimate), and its name. */
export const loanActions: Actions = {
  setRate: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const raw = String(form.get('rate') ?? '')
      .trim()
      .replace(/%$/, '')
      .trim();
    if (!id) return fail(400, { id, message: 'Bad request.' });

    // Blank clears it, and the estimate (if any) takes over again.
    let apr: number | null = null;
    if (raw !== '') {
      apr = Number(raw);
      if (!Number.isFinite(apr) || apr < 0 || apr > 40) {
        return fail(400, { id, message: 'Enter the annual rate as a percent, between 0 and 40.' });
      }
    }
    if (!(await setLoanRate(id, apr))) return fail(404, { id, message: 'No such loan.' });
    return { id, saved: true };
  },

  rename: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const name = String(form.get('name') ?? '');
    if (!id || !(await setLoanName(id, name))) return fail(404, { id, message: 'No such loan.' });
    return { id, renamed: true };
  }
};
