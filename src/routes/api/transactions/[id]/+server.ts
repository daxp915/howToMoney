import { error, json } from '@sveltejs/kit';
import { detail } from '$lib/server/activity';
import type { RequestHandler } from './$types';

/** One transaction's detail for the panel and the sheet. */
export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  const d = await detail(params.id, locals.user.email);
  if (!d) throw error(404, 'No such transaction');
  return json(d);
};
