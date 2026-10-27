import { error, json } from '@sveltejs/kit';
import { AdvisorBusy, AdvisorLimit, deleteConversation, getConversation, rerunTurn } from '$lib/server/advisor/agent';
import type { RequestHandler } from './$types';

// Checked before it reaches Postgres: a malformed uuid raises there, and a
// failed statement aborts the whole request's transaction.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One conversation, polled while `answering` is true. */
export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  if (!UUID.test(params.id)) throw error(404, 'Conversation not found');
  const conversation = await getConversation(locals.user.id, params.id);
  if (!conversation) throw error(404, 'Conversation not found');
  return json(conversation);
};

/**
 * `{ rerun: turnId }`: reopening a past question re-runs it on today's
 * figures (7a), and "Try again" after an error (7j) does the same.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  if (!UUID.test(params.id)) throw error(404, 'Conversation not found');
  const body = (await request.json().catch(() => ({}))) as { rerun?: unknown };
  if (typeof body.rerun !== 'string' || !UUID.test(body.rerun)) throw error(400, 'Nothing to re-run.');
  try {
    if (!(await rerunTurn(locals.user.id, body.rerun, locals.user.isAdmin))) throw error(404, 'Question not found');
  } catch (e) {
    if (e instanceof AdvisorBusy) throw error(409, e.message);
    if (e instanceof AdvisorLimit) throw error(429, e.message);
    throw e;
  }
  return json({ ok: true }, { status: 202 });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  if (!UUID.test(params.id)) throw error(404, 'Conversation not found');
  if (!(await deleteConversation(params.id))) throw error(404, 'Conversation not found');
  return json({ ok: true });
};
