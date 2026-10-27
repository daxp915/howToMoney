/**
 * "Something is wrong" — the path from a confused person to the person who can
 * fix it.
 *
 * The box itself cannot send mail: there is no SMTP anywhere in this stack, and
 * putting one here would mean a mail server to keep patched on a NAS that
 * cannot be patched. Instead the report is posted to a small Cloudflare Worker
 * (see `workers/feedback/`) which sends it on through Cloudflare Email Routing.
 *
 * What gets attached matters more than the form: the report carries the app
 * version, the sending user's id and their last sync error, because those three
 * answer most questions before a reply is needed. The user's *email* is not
 * sent -- the id is enough to find them, and a support mailbox is not a place to
 * accumulate addresses.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from './db';
import { accounts, syncRuns } from './db/schema';

export interface FeedbackReport {
  userId: string;
  /** Shown as "From" in the report email. */
  email?: string;
  kind: string;
  message: string;
  /** The page the person came to Help from, not Help itself. */
  page: string | null;
  /** "iPhone · Safari" -- coarse on purpose, see $lib/device. */
  browser?: string | null;
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'unconfigured' | 'failed'; detail?: string };

/** Gathered automatically, so nobody has to be asked "what were you doing?". */
async function collectContext(report: FeedbackReport): Promise<Record<string, unknown>> {
  const [lastSync] = await db
    .select({
      startedAt: syncRuns.startedAt,
      status: syncRuns.status,
      error: syncRuns.error
    })
    .from(syncRuns)
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  const linked = await db
    .select({ id: accounts.id, isActive: accounts.isActive })
    .from(accounts)
    .where(eq(accounts.provider, 'simplefin'));

  return {
    version: process.env.npm_package_version ?? 'unknown',
    node: process.version,
    browser: report.browser ?? null,
    lastSync: lastSync
      ? {
          at: lastSync.startedAt.toISOString(),
          status: lastSync.status,
          error: lastSync.error
        }
      : null,
    accounts: { total: linked.length, active: linked.filter((a) => a.isActive).length }
  };
}

export function feedbackConfigured(): boolean {
  return !!process.env.FEEDBACK_WEBHOOK_URL && !!process.env.FEEDBACK_WEBHOOK_SECRET;
}

export async function sendFeedback(report: FeedbackReport): Promise<SendResult> {
  const url = process.env.FEEDBACK_WEBHOOK_URL;
  const secret = process.env.FEEDBACK_WEBHOOK_SECRET;

  // Logged either way. If the Worker is not set up, or is down, the report
  // still exists somewhere a person can read it.
  const context = await collectContext(report);
  console.log(
    `[feedback] from=${report.userId} kind=${report.kind} page=${report.page ?? '-'}\n` +
      `${report.message}\ncontext=${JSON.stringify(context)}`
  );

  if (!url || !secret) return { ok: false, reason: 'unconfigured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // A shared secret rather than a signature: the Worker's only job is to
        // relay to one fixed address, so the risk is somebody using it as a
        // mail relay, which a secret already prevents.
        'x-htm-secret': secret
      },
      body: JSON.stringify({ userId: report.userId, email: report.email, kind: report.kind, message: report.message, page: report.page, context }),
      signal: AbortSignal.timeout(10_000)
    });

    if (!res.ok) {
      return { ok: false, reason: 'failed', detail: `${res.status} ${await res.text()}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}
