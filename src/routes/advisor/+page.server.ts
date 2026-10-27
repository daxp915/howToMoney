import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts, syncRuns } from '$lib/server/db/schema';
import { answering, getConversation, listConversations, questionsLeft } from '$lib/server/advisor/agent';
import { runCheckup } from '$lib/server/advisor/facts';
import { listLoans } from '$lib/server/loans';
import { accountDisplayName } from '$lib/accountName';
import type { PageServerLoad } from './$types';

/**
 * The Advisor (handoff 7a-7s): the checkup, worked out by the app with no
 * model involved, above Ask and the conversation, with past questions beside.
 *
 * `?c=<id>` opens a conversation; `?q=` puts a question in the box without
 * asking it ("Ask about it ›", Loans' "What if I paid more?"); `?view=` picks
 * the phone's Checkup / Ask / Past screen.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ url, locals }) => {
  const userId = locals.user!.id;
  const c = url.searchParams.get('c');

  const [checkup, conversations, [lastSync], live, loans, invest] = await Promise.all([
    runCheckup(),
    listConversations(),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.isActive, true), inArray(accounts.type, ['depository', 'credit', 'loan', 'investment']))),
    listLoans(),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.isActive, true), eq(accounts.type, 'investment')))
      .limit(1)
  ]);

  const conversation = c && UUID.test(c) ? await getConversation(userId, c) : null;

  // Suggestions name the household's own things, and drop what does not
  // apply: no loan question without a loan, no mix question without a fund.
  const loan = loans.find((l) => !l.paidOff && l.payment);
  // "the Tundra" from a loan the user named "Tundra loan"; a provider's
  // "Auto Loan" stays whole.
  const loanName = loan
    ? loan.nickname?.trim()
      ? loan.nickname.trim().replace(/\s+loan$/i, '')
      : accountDisplayName(loan)
    : null;
  const suggestions = [
    'Can I afford an $800 TV?',
    ...(loanName ? [`When will the ${loanName} be paid off if I add $200 a month?`] : []),
    'Am I saving enough?',
    'Where can I cut $300 a month?',
    ...(invest.length ? ['Is my investment mix reasonable?'] : [])
  ];

  return {
    checkup,
    conversations,
    conversation,
    answering: answering(userId),
    lastSync: lastSync
      ? { status: lastSync.status, at: lastSync.finishedAt ?? lastSync.startedAt }
      : null,
    accountCount: live.length,
    suggestions,
    // Said only when it is about to matter (five or fewer left).
    questionsLeft: locals.user!.isAdmin ? null : await questionsLeft(),
    prefill: (url.searchParams.get('q') ?? '').slice(0, 1000),
    view: url.searchParams.get('view')
  };
};
