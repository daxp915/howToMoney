/**
 * Syncing, watched rather than awaited -- shared by the top bar's sync button
 * and any page that reports how the last run went.
 *
 * The old version held `syncing` for the length of one HTTP request that ran
 * the entire sync -- eight to thirty-odd seconds, unbounded when the provider
 * stalled -- and cleared it in a `finally`. So the only thing that ever
 * un-stuck the button was that promise settling in this tab. A response lost
 * to a tunnel blip, a sleeping laptop or a throttled background tab left it
 * saying "Syncing…" over a sync that had finished and committed minutes
 * earlier, with no way back but a reload.
 *
 * Now the server owns the fact. POST starts the job and returns at once; this
 * polls until the server says it is done. Reloading mid-sync picks the state
 * back up (`resume()`), and a dropped poll is retried rather than fatal.
 *
 * Module state, like `privacy`: it starts idle on the server and is only ever
 * changed in the browser, so no request can see another's.
 */
import { invalidateAll } from '$app/navigation';

const POLL_MS = 1500;
/** Long enough for an 89-day pull across several institutions, then give up
 *  *watching* -- the sync itself carries on server-side either way. */
const POLL_LIMIT_MS = 5 * 60 * 1000;

interface SyncStatus {
  running: boolean;
  failure: string | null;
  lastSync: { status: string; error: string | null; finishedAt: string | null } | null;
}

let running = $state(false);
let error = $state<string | null>(null);
let note = $state<string | null>(null);
let resumed = false;

async function status(): Promise<SyncStatus> {
  const res = await fetch('/api/sync');
  if (!res.ok) throw new Error((await res.text()) || 'Could not read sync status');
  return (await res.json()) as SyncStatus;
}

/** Reports how the finished run went, using the server's own words. */
function report(s: SyncStatus) {
  if (s.failure) {
    error = s.failure;
  } else if (s.lastSync?.status === 'failed') {
    error = s.lastSync.error ?? 'Sync failed';
  } else if (s.lastSync?.status === 'completed_with_errors') {
    // Not a failure: accounts that did answer were still saved. Saying so is
    // the difference between "check your bank link" and silent partial data.
    note = s.lastSync.error
      ? `Synced, but the provider reported: ${s.lastSync.error}`
      : 'Synced, with some accounts reporting errors.';
  }
}

async function watch() {
  const until = Date.now() + POLL_LIMIT_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const s = await status();
      if (!s.running) {
        report(s);
        await invalidateAll();
        running = false;
        return;
      }
    } catch {
      // A failed poll is a network hiccup, not a failed sync. Keep watching;
      // the deadline is what stops this running forever.
    }
  }
  running = false;
  note = 'Still running after five minutes. Reload to see where it got to.';
}

export const sync = {
  get running() {
    return running;
  },
  get error() {
    return error;
  },
  get note() {
    return note;
  },

  async start() {
    if (running) return;
    running = true;
    error = null;
    note = null;
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (!res.ok) throw new Error((await res.text()) || 'Sync failed');
      await watch();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      running = false;
    }
  },

  /**
   * If a sync was already running when the app loaded -- someone reloaded
   * mid-sync, or started one in another tab -- show it as running and watch it
   * out. Without this the button reads idle over a sync in progress, and
   * pressing it gets a polite refusal for no visible reason. Once per load.
   */
  resume() {
    if (resumed) return;
    resumed = true;
    status()
      .then((s) => {
        if (!s.running || running) return;
        running = true;
        watch();
      })
      .catch(() => {
        // Nothing to recover: the button simply stays as it is.
      });
  },

  dismiss() {
    error = null;
    note = null;
  }
};
