/**
 * howToMoney mail relay.
 *
 * The app runs on a NAS with no mail server, and adding one would mean another
 * daemon to keep patched on a box that cannot be patched. This Worker is the
 * whole mail path, through Cloudflare Email Routing:
 *
 *   POST /           a Help-page report, to the fixed RECIPIENT
 *   POST /alert      a connection alert, to the user it concerns
 *   POST /heartbeat  "the box is alive"; the cron below emails RECIPIENT when
 *                    these stop, because a NAS that is off cannot say so
 *
 * It is not a general relay. Every request carries the shared secret, and
 * Email Routing refuses any recipient that is not a verified destination
 * address on the account -- so a leaked URL and secret still cannot mail a
 * stranger.
 */
import { EmailMessage } from 'cloudflare:email';
// Shared with the app, so an alert and a "not checking in" look like one product.
import { renderEmail } from '../../../src/lib/email';
import { backMail, downMail, reportMail, type Report } from '../../../src/lib/relayMails';

interface Env {
  /** Email Routing binding, declared in wrangler.jsonc. */
  SEND_EMAIL: { send(message: EmailMessage): Promise<void> };
  /** Last heartbeat and whether "down" has been mailed. */
  STATE: KVNamespace;
  /** Must match FEEDBACK_WEBHOOK_SECRET in the app's .env. */
  SHARED_SECRET: string;
  /** An address on a domain this zone routes, e.g. alerts@example.com. */
  SENDER: string;
  /** A verified Email Routing destination: reports and "the app is down". */
  RECIPIENT: string;
  /** Hours without a heartbeat before "down" is mailed. */
  DOWN_AFTER_HOURS?: string;
  /** Where the buttons go. */
  APP_URL?: string;
  /** The household's zone for times in emails (default America/New_York). */
  MAIL_TZ?: string;
}

/** UTF-8 to base64, wrapped at 76 columns as RFC 2045 asks. */
function b64(text: string): string {
  const raw = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  return raw.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

interface Body {
  text: string;
  html: string;
}

/**
 * RFC 5322 with what spam filters look for in a legitimate notice: an ASCII
 * subject left readable (base64-encoding a plain subject is a classic spam
 * tell), a text part and an HTML part, a Message-ID on the sending domain,
 * and `Auto-Submitted` marking it as an automated notification rather than
 * bulk mail. Authentication (SPF, DKIM, DMARC) is Cloudflare's and passes.
 */
function mime(env: Env, to: string, subject: string, body: Body): string {
  const text = body.text.replace(/\r\n/g, '\n');
  const boundary = `htm-${crypto.randomUUID()}`;
  const ascii = /^[\x20-\x7e]*$/.test(subject);
  return [
    `From: HTMFD <${env.SENDER}>`,
    `To: <${to}>`,
    `Reply-To: <${env.RECIPIENT}>`,
    `Message-ID: <${crypto.randomUUID()}@example.com>`,
    `Date: ${new Date().toUTCString()}`,
    `Subject: ${ascii ? subject : `=?utf-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`}`,
    'Auto-Submitted: auto-generated',
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(body.html),
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

async function send(env: Env, to: string, subject: string, body: Body): Promise<Response> {
  try {
    await env.SEND_EMAIL.send(new EmailMessage(env.SENDER, to, mime(env, to, subject, body)));
    return new Response('ok');
  } catch (e) {
    // The app logs everything it posts, so a failure here loses the mail, not
    // the content. Almost always an unverified destination address.
    return new Response(`Send failed: ${e instanceof Error ? e.message : e}`, { status: 502 });
  }
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

async function json<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

const hours = (env: Env) => Number(env.DOWN_AFTER_HOURS ?? 3);
const tz = (env: Env) => env.MAIL_TZ || 'America/New_York';
const app = (env: Env) => (env.APP_URL ?? 'https://money.example.com').replace(/\/+$/, '');

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    // Constant-time comparison is not worth it here: the secret is high-entropy
    // and the only signal a timing attack would leak is its length.
    if (request.headers.get('x-htm-secret') !== env.SHARED_SECRET) {
      return new Response('Forbidden', { status: 403 });
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    if (path === '/heartbeat') {
      const wasDown = (await env.STATE.get('down')) === '1';
      const previous = await env.STATE.get('last');
      await env.STATE.put('last', new Date().toISOString());
      if (wasDown) {
        await env.STATE.delete('down');
        const m = backMail(app(env), previous, new Date(), tz(env));
        return send(env, env.RECIPIENT, m.subject, renderEmail(m.doc, { subject: m.subject }));
      }
      return new Response('ok');
    }

    if (path === '/alert') {
      // The app renders the email (`$lib/alertPlan` through `$lib/email`) and
      // sends both parts. `html` is optional so an older app still gets mail.
      const a = await json<{ to?: string; subject?: string; text?: string; html?: string }>(request);
      if (!a?.to || !EMAIL.test(a.to) || !a.subject || !a.text) return new Response('Expected {to, subject, text, html?}', { status: 400 });
      if (a.subject.length > 200 || a.text.length > 8000 || (a.html?.length ?? 0) > 100_000) return new Response('Too long', { status: 413 });
      const subject = a.subject.replace(/[\r\n]+/g, ' ');
      const html =
        a.html ??
        renderEmail({ preheader: a.text.slice(0, 120), tone: 'neutral', eyebrow: 'Connections', heading: subject, lead: a.text, footer: '' }).html;
      return send(env, a.to, subject, { text: a.text, html });
    }

    if (path === '/') {
      const report = await json<Report>(request);
      if (!report) return new Response('Expected JSON', { status: 400 });
      if (!report.message || typeof report.message !== 'string') return new Response('Missing message', { status: 400 });
      if (report.message.length > 8000) return new Response('Message too long', { status: 413 });
      const m = reportMail(report, app(env), new Date(), tz(env));
      return send(env, env.RECIPIENT, m.subject, renderEmail(m.doc, { subject: m.subject }));
    }

    return new Response('Not found', { status: 404 });
  },

  /** Every 30 minutes: has the box gone quiet? Mailed once per outage. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const last = await env.STATE.get('last');
    if (!last) return; // Never heard from: not set up yet, nothing to miss.
    const quiet = Date.now() - Date.parse(last);
    if (quiet < hours(env) * 36e5) return;
    if ((await env.STATE.get('down')) === '1') return;
    const m = downMail(app(env), last, new Date(), tz(env));
    const res = await send(env, env.RECIPIENT, m.subject, renderEmail(m.doc, { subject: m.subject }));
    if (res.ok) await env.STATE.put('down', '1');
  }
};
