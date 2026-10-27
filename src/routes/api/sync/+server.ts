import { error, json } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { syncRuns } from '$lib/server/db/schema';
import { startSync, syncStatus } from '$lib/server/syncJob';
import type { RequestHandler } from './$types';

/**
 * A manual sync from the dashboard. The scheduled path lives in the worker
 * container; this is here for "I just bought something, show me".
 *
 * POST starts one and returns immediately. GET reports whether one is running.
 *
 * It used to run the whole sync inline and return the summary, which made the
 * HTTP request as long as the sync -- eight to thirty-odd seconds in practice,
 * unbounded when the provider stalled. Any response lost in between (a tunnel
 * blip, a sleeping laptop, a background tab the browser throttled) left the
 * button saying "Syncing…" forever over a sync that had finished and committed
 * minutes earlier, because the only thing that cleared it was the promise
 * settling in the browser. Progress is now a server fact the page can ask for,
 * so a reload tells the truth and a lost response costs nothing.
 *
 * The job itself (one per user across every process, picked up again if its
 * process dies, failures that never reached `sync_runs`) is
 * `$lib/server/syncJob`, shared with the worker's schedule.
 */

export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  // Already running is not an error: the caller wanted a sync running, and one
  // is. Telling the page to go and watch it beats a 409 it has to translate.
  const started = await startSync(locals.user.id);
  return json({ started, running: true }, { status: 202 });
};

/**
 * Is a sync running, and how did the last one go?
 *
 * The page polls this instead of holding a boolean of its own, which is what
 * makes the button survive a reload mid-sync and recover from a lost response.
 */
export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  const [last] = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1);

  const { running, failure } = await syncStatus();
  return json({
    running,
    failure,
    lastSync: last
      ? {
          id: last.id,
          startedAt: last.startedAt,
          finishedAt: last.finishedAt,
          status: last.status,
          error: last.error,
          accountsSynced: last.accountsSynced,
          inserted: last.txnsInserted,
          updated: last.txnsUpdated
        }
      : null
  });
};
