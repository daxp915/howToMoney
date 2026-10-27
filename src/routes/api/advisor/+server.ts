import { error, json } from '@sveltejs/kit';
import { AdvisorBusy, AdvisorLimit, answering, askAdvisor, listConversations, questionsLeft } from '$lib/server/advisor/agent';
import { runCheckup } from '$lib/server/advisor/facts';
import type { RequestHandler } from './$types';

/**
 * The Advisor.
 *
 * GET: the checkup (worked out by the app, no model, nothing sent anywhere),
 * past conversations, and whether a question is being answered.
 *
 * POST `{ question, conversationId?, context? }`: records the question and starts
 * answering it in the background -- 202 with the ids to poll at
 * `/api/advisor/<conversationId>`. Same reasoning as `/api/sync`: an answer
 * takes several model calls, and a lost response must not lose the answer.
 */
export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  const [checkup, conversations, left] = await Promise.all([runCheckup(), listConversations(), questionsLeft()]);
  return json({
    checkup,
    conversations,
    answering: answering(locals.user.id),
    questionsLeft: locals.user.isAdmin ? null : left
  });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; conversationId?: unknown; context?: unknown };
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) throw error(400, 'Ask a question first.');
  const conversationId = typeof body.conversationId === 'string' && body.conversationId ? body.conversationId : null;
  if (conversationId && !/^[0-9a-f-]{36}$/i.test(conversationId)) throw error(404, 'Conversation not found');

  try {
    // The screen it was asked from ("Plan · October"), a short label only.
    const context = typeof body.context === 'string' ? body.context.replace(/[^\p{L}\p{N} ·,.'&$-]/gu, '').slice(0, 80) || null : null;
    const ids = await askAdvisor(locals.user.id, question, conversationId, context, locals.user.isAdmin);
    return json(ids, { status: 202 });
  } catch (e) {
    if (e instanceof AdvisorBusy) throw error(409, e.message);
    if (e instanceof AdvisorLimit) throw error(429, e.message);
    if (e instanceof Error && e.message === 'Conversation not found') throw error(404, e.message);
    throw e;
  }
};
