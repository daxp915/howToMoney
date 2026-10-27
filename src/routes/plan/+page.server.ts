import { envelopeActions, loadEnvelopes } from './envelopes.server';
import { goalActions, loadGoals } from './goals.server';
import { recurringActions } from './recurring.server';
import type { Actions, PageServerLoad } from './$types';

/**
 * Plan (v2): Envelopes · Recurring · Goals behind one segmented control,
 * chosen by `?tab=`. Envelopes and Recurring share one load (desktop shows
 * both); Goals loads alone. The three used to be
 * separate routes; their loaders and actions are unchanged modules beside this
 * file, and their action names do not collide, so one page can carry all of
 * them.
 */
export type PlanTab = 'envelopes' | 'recurring' | 'goals';

export const load: PageServerLoad = async ({ url }) => {
  const asked = url.searchParams.get('tab');
  if (asked === 'goals') return { tab: 'goals' as const, goals: await loadGoals() };
  return { tab: asked === 'recurring' ? ('recurring' as const) : ('envelopes' as const), month: await loadEnvelopes() };
};

export const actions: Actions = { ...envelopeActions, ...recurringActions, ...goalActions };
