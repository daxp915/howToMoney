import { fail } from '@sveltejs/kit';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts, syncRuns } from '$lib/server/db/schema';
import { feedbackConfigured, sendFeedback } from '$lib/server/feedback';
import { describeDevice } from '$lib/device';
import type { Actions, PageServerLoad } from './$types';

const KINDS = new Set(['wrong', 'question', 'idea']);

// What the "Sent along with it" card shows is what collectContext() attaches:
// the last sync, and where the person was. Said in the Bank link page's words.
export const load: PageServerLoad = async () => {
  const [lastSync] = await db
    .select({ at: syncRuns.startedAt, finishedAt: syncRuns.finishedAt, status: syncRuns.status })
    .from(syncRuns)
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  const stopped = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.isActive, false), ne(accounts.provider, 'manual')));

  return {
    configured: feedbackConfigured(),
    lastSync: lastSync
      ? { at: lastSync.finishedAt ?? lastSync.at, status: lastSync.status, stopped: stopped.length }
      : null
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const browser = describeDevice(request.headers.get('user-agent')).name;
    const form = await request.formData();
    const picked = String(form.get('kind') ?? '');
    const kind = KINDS.has(picked) ? picked : 'question';
    const message = String(form.get('message') ?? '').trim();
    // A path on this site, or nothing: it is echoed into an email.
    const from = String(form.get('page') ?? '');
    const page = /^\/[\w\-/]*$/.test(from) ? from.slice(0, 200) : null;

    if (message.length < 5) {
      return fail(400, { message: 'Tell me a little about what happened, in your own words.' });
    }
    if (message.length > 4000) {
      return fail(400, { message: 'That is longer than the form can send. Trim it a little.' });
    }

    const result = await sendFeedback({ userId: locals.user!.id, email: locals.user!.email, kind, message, page, browser });

    if (!result.ok) {
      // The report is in the server log either way, so this is "it did not
      // arrive by mail", not "it is lost".
      return fail(502, {
        message:
          result.reason === 'unconfigured'
            ? 'Sending is not set up on this server yet, but your message was recorded in the log.'
            : 'Your message could not be delivered just now. It was recorded in the log, so the administrator can still see it.'
      });
    }

    return { success: true };
  }
};
