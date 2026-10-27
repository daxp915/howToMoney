import { error } from '@sveltejs/kit';
import { loanActions } from '../loans.server';
import { loadWealth } from '../wealth.server';
import type { Actions, PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One account in Wealth: the panel on desktop, a pushed screen on a phone. */
export const load: PageServerLoad = async ({ params, url, locals }) => {
  // Checked before any query: Postgres raises on a malformed uuid, and a
  // failed statement aborts the whole request's transaction.
  if (!UUID.test(params.accountId)) throw error(404, 'No such account');
  const data = await loadWealth(url, params.accountId, locals.user?.email ?? null);
  if (data.selectedId !== params.accountId) throw error(404, 'No such account');
  return data;
};

export const actions: Actions = { ...loanActions };
