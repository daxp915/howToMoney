import { error, json } from '@sveltejs/kit';
import { checkupSummary } from '$lib/server/advisor/facts';
import type { RequestHandler } from './$types';

/** The checkup in brief: counts by severity for the More sheet's tag (7p). */
export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  return json(await checkupSummary());
};
