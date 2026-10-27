import { loanActions } from './loans.server';
import { loadWealth } from './wealth.server';
import type { Actions, PageServerLoad } from './$types';

/** Wealth. See wealth.server.ts. */
export const load: PageServerLoad = async ({ url, locals }) => loadWealth(url, null, locals.user?.email ?? null);

export const actions: Actions = { ...loanActions };
