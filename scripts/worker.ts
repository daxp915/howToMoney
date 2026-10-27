import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { existsSync, readFileSync } from 'node:fs';
import { dataCollection, scrubBreadcrumb, scrubEvent } from '../src/lib/sentry';
import { claimSync, resumeOrphanedSyncs, runJob } from '../src/lib/server/syncJob';
import { usersWithCredentials } from '../src/lib/server/users';
import { purgeExpiredSessions } from '../src/lib/server/auth';
import { alertsConfigured, checkAlerts, heartbeat } from '../src/lib/server/alerts';

// Long-running sync worker. Runs in its own container so a slow or failed sync
// can never block a page render, and so the web container stays stateless.
//
// SimpleFIN refreshes institution data on its own cadence; polling more than a
// few times a day buys nothing.

// Same project and privacy rules as the web app; `service: worker` tells the
// two apart. Off without SENTRY_DSN. The loop catches its own errors to keep
// going, so each catch reports explicitly -- tagged by step, never by email.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  release: process.env.SENTRY_RELEASE || (existsSync('RELEASE') ? readFileSync('RELEASE', 'utf8').trim() : undefined),
  dataCollection,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  initialScope: { tags: { service: 'worker' } }
});

const report = (step: string, err: unknown) => Sentry.captureException(err, { tags: { step } });

const intervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 360);
const intervalMs = Math.max(15, intervalMinutes) * 60 * 1000;

let consecutiveFailures = 0;

async function tick() {
  const started = Date.now();

  // Housekeeping first, so it runs even on a pass with nobody to sync.
  try {
    const purged = await purgeExpiredSessions();
    if (purged) console.log(`[worker] removed ${purged} expired session(s)`);
  } catch (err) {
    console.error('[worker] session cleanup failed:', err instanceof Error ? err.message : err);
    report('session-cleanup', err);
  }

  // Each user holds their own SimpleFIN credentials, so a pass is one sync per
  // user. One person's revoked token must not stop anybody else's sync, which
  // is why failures are counted per user and the loop continues.
  let users: Array<{ id: string; email: string }> = [];
  try {
    users = await usersWithCredentials();
  } catch (err) {
    consecutiveFailures++;
    console.error(
      `[worker] could not list users (${consecutiveFailures} in a row):`,
      err instanceof Error ? err.message : err
    );
    report('list-users', err);
    return;
  }

  if (!users.length) {
    console.log('[worker] nobody has a bank connection yet; nothing to sync');
    return;
  }

  let failed = 0;
  for (const user of users) {
    try {
      // 30 days (`syncJob.ts`): SimpleFIN warns above 45, and a routine sync
      // only needs enough overlap to catch late-posting and pending rows.
      // Through the same job table as the Sync button, so a scheduled pass
      // never runs beside a sync the person started a moment earlier.
      const jobId = await claimSync(user.id, 'schedule');
      if (!jobId) {
        console.log(`[worker] ${user.email} already syncing; skipped`);
        continue;
      }
      const summary = await runJob(user.id, jobId);
      console.log(
        `[worker] ${user.email} ok accounts=${summary.accountsSynced} new=${summary.inserted} ` +
          `reconciled=${summary.reconciledPending} transfers=${summary.transfersMatched} ` +
          `review=${summary.transfersQueued} ai=$${summary.aiCostUsd.toFixed(4)}`
      );
      if (summary.errors.length) {
        console.warn(`[worker] ${user.email} provider errors:`, summary.errors);
      }
    } catch (err) {
      failed++;
      console.error(
        `[worker] ${user.email} sync failed:`,
        err instanceof Error ? err.message : err
      );
      report('sync', err);
    }
  }

  // Connection emails, after every user's sync so they describe this pass.
  // A user whose sync threw still gets checked: that failed run is exactly
  // what the email is for.
  for (const user of users) {
    try {
      const sent = await checkAlerts(user);
      if (sent) console.log(`[worker] ${user.email} alert email: ${sent}`);
    } catch (err) {
      console.error(`[worker] ${user.email} alert check failed:`, err instanceof Error ? err.message : err);
      report('alerts', err);
    }
  }

  // Back off only when nobody succeeded; one broken connection among several
  // should not slow the others down.
  consecutiveFailures = failed === users.length ? consecutiveFailures + 1 : 0;
  console.log(
    `[worker] pass done in ${Math.round((Date.now() - started) / 1000)}s ` +
      `users=${users.length} failed=${failed}`
  );
}

/**
 * Hourly "still here" to the relay Worker, on its own timer: a sync pass can
 * back off for up to two days, and the Worker must not read that as the box
 * being down. If these stop for three hours, the Worker emails.
 */
function startHeartbeat() {
  if (!alertsConfigured()) {
    console.log('[worker] FEEDBACK_WEBHOOK_URL/SECRET unset: no alert emails, no heartbeat');
    return;
  }
  const beat = () =>
    heartbeat().catch((err) => console.error('[worker] heartbeat failed:', err instanceof Error ? err.message : err));
  void beat();
  setInterval(beat, 60 * 60 * 1000);
}

/**
 * Syncs whose process died partway (a deploy, a crash) are taken over here.
 * Every minute, because someone may be watching the button wait for it.
 */
function startOrphanSweep() {
  let busy = false;
  const sweep = async () => {
    if (busy) return;
    busy = true;
    try {
      await resumeOrphanedSyncs();
    } catch (err) {
      console.error('[worker] orphaned-sync sweep failed:', err instanceof Error ? err.message : err);
      report('orphan-sweep', err);
    } finally {
      busy = false;
    }
  };
  void sweep();
  setInterval(sweep, 60_000);
}

async function main() {
  console.log(`[worker] starting, interval ${intervalMinutes}m`);
  startHeartbeat();
  startOrphanSweep();
  for (;;) {
    await tick();
    // Back off after repeated failures so a revoked SimpleFIN token doesn't
    // hammer the bridge every interval. Caps at 8x the normal interval.
    const delay = intervalMs * Math.min(2 ** consecutiveFailures, 8);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

void main();
