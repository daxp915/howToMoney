import { error, json } from '@sveltejs/kit';
import { stopAdvisor } from '$lib/server/advisor/agent';
import type { RequestHandler } from './$types';

/** "Stop" on the thinking card (7d): the answer is abandoned and the
 *  question handed back for the box. */
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  return json((await stopAdvisor(locals.user.id)) ?? { question: null, conversationId: null });
};
