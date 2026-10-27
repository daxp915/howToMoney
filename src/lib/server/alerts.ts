/**
 * Connection alert emails, and the heartbeat that tells the Cloudflare Worker
 * this box is alive.
 *
 * The NAS cannot send mail (no SMTP, on purpose -- see feedback.ts), so both
 * go to the relay Worker in `workers/feedback/`, which sends through
 * Cloudflare Email Routing. The Worker also watches the heartbeat: if it
 * stops, the NAS, the worker container or the network is down, and that is
 * the one failure this process cannot report itself.
 *
 * Imported by `scripts/worker.ts`, so relative imports only (no `$lib` under
 * tsx).
 */
import { db, runAsUser } from './db';
import { userPreferences } from './db/schema';
import { loadConnectionHealth } from './connectionHealth';
import { planAlert, type AlertEmail } from '../alertPlan';

const base = () => (process.env.FEEDBACK_WEBHOOK_URL ?? '').replace(/\/+$/, '');
const secret = () => process.env.FEEDBACK_WEBHOOK_SECRET ?? '';

export const alertsConfigured = () => !!base() && !!secret();

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-htm-secret': secret() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
}

export const sendAlertEmail = (to: string, email: AlertEmail) =>
  post('/alert', { to, subject: email.subject, text: email.text, html: email.html });

/** "Still here." The Worker emails when these stop for three hours. */
export const heartbeat = () => post('/heartbeat', { at: new Date().toISOString() });

/**
 * One user's check after a sync pass: work out the email, send it, and only
 * then record it -- a send that fails is tried again on the next pass rather
 * than marked as told.
 */
export async function checkAlerts(user: { id: string; email: string }): Promise<AlertEmail['kind'] | null> {
  if (!alertsConfigured()) return null;
  const appUrl = (process.env.ORIGIN ?? 'https://money.example.com').replace(/\/+$/, '');

  const plan = await runAsUser(user.id, async () => {
    const [prefs] = await db
      .select({ on: userPreferences.emailAlerts, keys: userPreferences.alertedIssues, at: userPreferences.alertedAt })
      .from(userPreferences)
      .limit(1);
    if (prefs && !prefs.on) return null;
    const { issues, banks, lastSync } = await loadConnectionHealth();
    return planAlert(issues, { keys: prefs?.keys ?? [], at: prefs?.at ?? null }, new Date(), appUrl, {
      banks,
      lastSync,
      tz: process.env.MAIL_TZ || undefined
    });
  });
  if (!plan) return null;

  if (plan.email) await sendAlertEmail(user.email, plan.email);

  // Recorded in a scope of its own, after the send: no connection idles
  // through the HTTP call.
  await runAsUser(user.id, async () => {
    const values = { alertedIssues: plan.next.keys, alertedAt: plan.next.at, updatedAt: new Date() };
    await db
      .insert(userPreferences)
      .values(values)
      .onConflictDoUpdate({ target: [userPreferences.userId], set: values });
  });
  return plan.email?.kind ?? null;
}

/** Settings' "Email me when a connection breaks". */
export async function setEmailAlerts(on: boolean): Promise<void> {
  const values = { emailAlerts: on, updatedAt: new Date() };
  await db.insert(userPreferences).values(values).onConflictDoUpdate({ target: [userPreferences.userId], set: values });
}

export async function emailAlertsOn(): Promise<boolean> {
  const [row] = await db.select({ on: userPreferences.emailAlerts }).from(userPreferences).limit(1);
  return row?.on ?? true;
}
