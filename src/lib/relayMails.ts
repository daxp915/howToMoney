/**
 * The emails the relay Worker (`workers/feedback/`) writes itself: the server
 * watch ("not checking in", "back") and Help-page reports, as the Claude
 * Design email handoff draws them. Pure, apart from the clock you pass in, so
 * the preview script and the dev route draw them without a Worker runtime.
 * Imports nothing outside `$lib` that the Worker cannot bundle.
 */
import type { MailDoc } from './email';
import { duration, mailDates, MAIL_TZ } from './mailDates';

export interface Report {
  userId?: string;
  /** Who sent it, when the app knows. */
  email?: string;
  kind?: string;
  message?: string;
  page?: string | null;
  context?: unknown;
}

const SERVER_FOOTER = 'This is the server watch: one email when it goes quiet, one when it is back.';
const HALF_HOUR = 18e5;

/** 24 half-hour blocks ending now, oldest first. */
const blocks = (now: Date) => Array.from({ length: 24 }, (_, i) => now.getTime() - (24 - i) * HALF_HOUR);

export function downMail(appUrl: string, last: string, now = new Date(), tz = MAIL_TZ): { subject: string; doc: MailDoc } {
  const d = mailDates(tz);
  const heard = new Date(last);
  const quiet = now.getTime() - heard.getTime();
  const at = `${d.time(heard)} ${d.zone(heard)}`;
  return {
    subject: 'howToMoney is not checking in',
    doc: {
      preheader: `Last heard ${at}. Nothing syncs until it is back.`,
      tone: 'over',
      icon: 'server-quiet',
      eyebrow: 'Server watch',
      status: 'Quiet',
      heading: 'howToMoney is not checking in',
      figure: { value: duration(quiet), unit: `since ${at}` },
      meta: `Last heard ${d.stamp(heard)} ${d.zone(heard)} · ${duration(quiet)} ago`,
      timeline: {
        kind: 'hours',
        // A block is heard if the last heartbeat came after it started.
        cells: blocks(now).map((start) => (start < heard.getTime() ? 'heard' : 'quiet')),
        start: d.time(new Date(now.getTime() - 24 * HALF_HOUR)),
        end: `Now, ${d.time(now)}`,
        caption: 'Each block is half an hour. Grey: checked in. Red: quiet.'
      },
      lead: 'Nothing syncs until it is back. One of these is usually why:',
      itemsLabel: 'Usually one of these',
      items: [
        { num: '1', title: 'The NAS is off or asleep', detail: 'Check it shows as online in Tailscale.' },
        { num: '2', title: 'The worker container stopped', detail: 'Find it, then restart it.', code: 'docker ps' },
        { num: '3', title: 'The network is down', detail: 'If the router is out, it comes back on its own.' }
      ],
      secondary: { label: 'Try opening HTMFD', url: appUrl },
      footer: SERVER_FOOTER
    }
  };
}

/** `last` is the heartbeat before the outage; `now` the one that ended it. */
export function backMail(appUrl: string, last: string | null, now = new Date(), tz = MAIL_TZ): { subject: string; doc: MailDoc } {
  const d = mailDates(tz);
  const heard = last ? new Date(last).getTime() : null;
  const gap = heard ? now.getTime() - heard : null;
  return {
    subject: 'howToMoney is checking in again',
    doc: {
      preheader: `${gap ? `Quiet for about ${duration(gap)}. ` : ''}Syncing has resumed.`,
      tone: 'ok',
      icon: 'server-back',
      eyebrow: 'Server watch',
      status: 'Back',
      heading: 'howToMoney is checking in again',
      figure: gap ? { value: duration(gap), unit: 'quiet, now back' } : undefined,
      meta: gap ? `Quiet for about ${duration(gap)}` : undefined,
      timeline: {
        kind: 'hours',
        cells: blocks(now).map((start, i) => (i === 23 ? 'back' : heard !== null && start < heard ? 'heard' : 'quiet')),
        start: 'Last 12 hours',
        end: `Back at ${d.time(now)}`,
        caption: 'Grey: checked in. Light: quiet. Green: back.'
      },
      lead: 'Syncing has resumed. Anything missed in between arrives with the next sync.',
      secondary: { label: 'Open HTMFD', url: appUrl },
      footer: SERVER_FOOTER
    }
  };
}

/** The Help page's choices, as it labels them. */
const KIND: Record<string, string> = { wrong: 'Something looks wrong', question: 'A question', idea: 'An idea' };

export function reportMail(report: Report, appUrl: string, now = new Date(), tz = MAIL_TZ): { subject: string; doc: MailDoc } {
  const d = mailDates(tz);
  const message = report.message ?? '';
  const kind = KIND[report.kind ?? ''] ?? 'A message from the app';
  const short = message.replace(/\s+/g, ' ').trim();
  const page = report.page ?? null;
  return {
    subject: `Report: ${kind}`,
    doc: {
      preheader: `“${short.length > 80 ? `${short.slice(0, 78).trimEnd()}…` : short}”`,
      tone: 'neutral',
      eyebrow: 'Help report',
      status: 'From the Help page',
      heading: kind,
      meta: `${d.stamp(now)} ${d.zone(now)}`,
      message,
      context: [
        ['Page', page ?? 'unknown'],
        ['From', report.email ?? report.userId ?? 'unknown']
      ],
      code: JSON.stringify(report.context ?? {}, null, 2),
      secondary: page ? { label: 'Open the page', url: `${appUrl}${page.startsWith('/') ? '' : '/'}${page}` } : undefined,
      footer: 'Sent from the Help page in HTMFD. Only you get these.'
    }
  };
}
