import { json } from '@sveltejs/kit';
import { drillSummary, readFilters } from '$lib/server/activity';
import type { RequestHandler } from './$types';

/**
 * The rows behind a figure, for opening it in place inside an Advisor answer
 *. Takes exactly the query string of the figure's Activity link,
 * read by the same `readFilters()`, so the card and the list agree. Row-level
 * security scopes it like every other read.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return new Response('Sign in first', { status: 401 });
  return json(await drillSummary(readFilters(url)));
};
