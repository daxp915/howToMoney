/**
 * Sync jobs: the Sync button (`/api/sync`), connecting a bank (the page then
 * presses Sync for you) and the worker's schedule all go through here.
 *
 * A job is a row in `sync_jobs`, not an entry in process memory. Two things
 * needed that:
 *
 * - **One sync per person, across processes.** Two concurrent syncs for one
 *   user race on pending reconciliation. The guard used to be a Map in the web
 *   process, which a second web container would not share and the worker never
 *   consulted. Now the claim is an INSERT against a partial unique index (one
 *   open job per user): exactly one claimant wins, wherever it runs.
 * - **A sync outlives the process that started it.** A deploy or a crash
 *   mid-sync used to drop the job on the floor. The runner touches
 *   `heartbeat_at` every 20 seconds; a job whose heartbeat goes stale has lost
 *   its runner, and the worker (`resumeOrphanedSyncs()`) takes it over -- up to
 *   three attempts, so a sync that kills its process cannot loop forever.
 *
 * The claim goes through `systemDb` with an explicit user id, on purpose. It
 * must be committed *before* the job starts: a claim made inside the request's
 * transaction is invisible to the job's own transactions until the request
 * commits, so a sync that failed in the first millisecond would try to close a
 * row it cannot see, and leave it open for the worker to retry a sync that was
 * never going to work. Everything after the claim runs in the user's own scope.
 */
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { runSync, type SyncSummary } from './sync/sync';
import { db, runAsUser, systemDb } from './db';
import { syncJobs } from './db/schema';

const HEARTBEAT_MS = 20_000;
/** No heartbeat for this long: the runner is gone; the worker takes the job over. */
export const STALE_MS = 2 * 60_000;
/**
 * No heartbeat for this long and nobody took it over (no worker running, as on
 * a laptop): the job is closed so it stops blocking the next press.
 */
const ABANDONED_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

/** Routine syncs pull 30 days ("A date-range advisory is not an error"). */
const DAYS = 30;

/** 'webhook': Plaid said a bank has new transactions. */
export type SyncOrigin = 'manual' | 'schedule' | 'webhook';

/**
 * Claims the one open sync job for `userId`. Returns its id, or null when a
 * sync is already running for them -- not an error: the caller wanted a sync
 * running, and one is.
 */
export async function claimSync(userId: string, origin: SyncOrigin): Promise<string | null> {
  const abandoned = new Date(Date.now() - ABANDONED_MS);
  await systemDb
    .update(syncJobs)
    .set({ finishedAt: new Date(), error: 'interrupted', errorSeenAt: new Date() })
    .where(and(eq(syncJobs.userId, userId), isNull(syncJobs.finishedAt), lt(syncJobs.heartbeatAt, abandoned)));
  const [row] = await systemDb
    .insert(syncJobs)
    .values({ userId, origin })
    .onConflictDoNothing()
    .returning({ id: syncJobs.id });
  return row?.id ?? null;
}

/**
 * Runs a claimed job to the end and closes it. Resolves with the summary, or
 * rejects with the sync's own error after recording it on the job.
 */
export async function runJob(userId: string, jobId: string): Promise<SyncSummary> {
  const touch = (set: Partial<typeof syncJobs.$inferInsert>) =>
    runAsUser(userId, () =>
      db.update(syncJobs).set(set).where(and(eq(syncJobs.id, jobId), isNull(syncJobs.finishedAt)))
    );
  const beat = setInterval(() => {
    touch({ heartbeatAt: new Date() }).catch((e) => console.error('[sync] heartbeat failed', e));
  }, HEARTBEAT_MS);
  try {
    const summary = await runAsUser(userId, () => runSync({ days: DAYS }));
    await touch({ finishedAt: new Date() });
    return summary;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await touch({ finishedAt: new Date(), error: message }).catch((err) =>
      console.error('[sync] could not record a failed job', err)
    );
    throw e;
  } finally {
    clearInterval(beat);
  }
}

/**
 * Starts a sync for `userId` in the background unless one is already running.
 * Returns whether this call started it.
 */
export async function startSync(userId: string, origin: SyncOrigin = 'manual'): Promise<boolean> {
  const jobId = await claimSync(userId, origin);
  if (!jobId) return false;

  // Deferred to the next tick so the sync's transaction never overlaps the
  // request's own. `runAsUser` always opens a fresh transaction on the pool
  // rather than borrowing the caller's, and sets `app.user_id` with
  // `set_config(..., true)`, so the scope belongs to this work and dies with
  // it -- this is a detached job that happens to be started by a request, not
  // a scope nested inside one.
  setTimeout(() => {
    runJob(userId, jobId).catch((e: unknown) => {
      // The stack only exists here. Whatever the page ends up showing, the
      // cause has to survive in the container log.
      console.error('[sync] background sync failed', e);
    });
  }, 0);
  return true;
}

/**
 * The page's view of the current user's sync (called in their scope): is one
 * running, and did the last one throw? A failure is read and marked seen, so
 * it is reported once, to whoever was waiting for it.
 *
 * `sync_runs` already says how a sync that got going went; `error` here is
 * for a throw before its run row existed -- no provider credentials, a bad
 * access URL -- which would otherwise leave the page with nothing to say.
 */
export async function syncStatus(): Promise<{ running: boolean; failure: string | null }> {
  const [latest] = await db.select().from(syncJobs).orderBy(desc(syncJobs.requestedAt)).limit(1);
  if (!latest) return { running: false, failure: null };
  if (!latest.finishedAt) return { running: true, failure: null };
  if (latest.error && !latest.errorSeenAt) {
    await db.update(syncJobs).set({ errorSeenAt: new Date() }).where(eq(syncJobs.id, latest.id));
    return { running: false, failure: latest.error };
  }
  return { running: false, failure: null };
}

/**
 * The worker's half of durability: every open job whose runner stopped
 * heartbeating is taken over and run again. The takeover is a conditional
 * UPDATE, so two workers cannot both win one job. Cross-tenant by nature (whose
 * syncs were orphaned?), hence `systemDb`, filtered by job id and user id.
 */
export async function resumeOrphanedSyncs(log = console.log): Promise<number> {
  const stale = new Date(Date.now() - STALE_MS);
  const orphans = await systemDb
    .select({ id: syncJobs.id, userId: syncJobs.userId })
    .from(syncJobs)
    .where(and(isNull(syncJobs.finishedAt), lt(syncJobs.heartbeatAt, stale)));

  let resumed = 0;
  for (const job of orphans) {
    const [taken] = await systemDb
      .update(syncJobs)
      .set({ heartbeatAt: new Date(), attempts: sql`${syncJobs.attempts} + 1` })
      .where(and(eq(syncJobs.id, job.id), isNull(syncJobs.finishedAt), lt(syncJobs.heartbeatAt, stale)))
      .returning({ attempts: syncJobs.attempts });
    if (!taken) continue;
    if (taken.attempts > MAX_ATTEMPTS) {
      await systemDb
        .update(syncJobs)
        .set({ finishedAt: new Date(), error: 'The sync stopped partway several times. Try again later.' })
        .where(and(eq(syncJobs.id, job.id), eq(syncJobs.userId, job.userId)));
      continue;
    }
    log(`[worker] resuming an interrupted sync (attempt ${taken.attempts})`);
    resumed++;
    await runJob(job.userId, job.id).catch((e) => console.error('[worker] resumed sync failed', e));
  }
  return resumed;
}

