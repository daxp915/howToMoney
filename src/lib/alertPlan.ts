import { SIMPLEFIN_URL } from './simplefin';
import { slug, type ConnectionIssue } from './connectionHealth';
import { renderEmail, type MailDoc, type MailItem, type MailLink, type MailTone } from './email';
import { initials } from './format';
import { duration, mailDates, MAIL_TZ } from './mailDates';

/**
 * Which connection email, if any, to send after a sync pass -- and what it
 * says.
 *
 * The banner tells someone who opens the app. This is for someone who does
 * not: a bank that failed on a Sunday is otherwise found on the Friday the
 * balance looks wrong. Rules, in order:
 *
 * - a problem not in the last email is news: mail it (with any still open);
 * - nothing new, but problems still open 3 days after the last email: remind;
 * - nothing open after an email about problems: say it is fixed, once;
 * - otherwise nothing. One email per problem, not one per six-hour sync.
 *
 * "No sync since" is left out: the worker that sends these is the thing that
 * stopped. The Cloudflare Worker's heartbeat check covers that case.
 *
 * Pure, so `npm run test:health` covers it.
 */

export interface AlertState {
  /** Issue keys the last email covered. */
  keys: string[];
  at: Date | null;
}

/** What the email lists besides the problems. */
export interface AlertContext {
  /** Every bank SimpleFIN feeds, by display name. */
  banks: string[];
  /** When the last clean sync ran ("Synced today, 9:12 AM"). */
  lastSync: Date | null;
  tz?: string;
  /** Where the icons are; the relay Worker by default. */
  assetBase?: string;
}

export interface AlertEmail {
  kind: 'new' | 'reminder' | 'resolved';
  subject: string;
  text: string;
  html: string;
}

const REMIND_AFTER = 3 * 864e5;

const FOOTER = 'You get one email per problem, a reminder every 3 days while it lasts, and one when it is fixed.';

/** The connection-wide problems: no bank can update. */
const ALL_DOWN = new Set(['access', 'no-credential', 'key', 'failed', 'down']);

type Dates = ReturnType<typeof mailDates>;

interface Ctx {
  now: Date;
  appUrl: string;
  banks: string[];
  lastSync: Date | null;
  d: Dates;
}

const connections = (c: Ctx): MailLink => ({ label: 'Open Connections', url: `${c.appUrl}/settings/connections` });

/** The button and the link beside it, per kind of fix. */
function actions(x: ConnectionIssue, c: Ctx): Pick<MailDoc, 'action' | 'secondary'> {
  switch (x.fix) {
    case 'simplefin':
      return { action: { label: 'Fix at SimpleFIN ↗', url: SIMPLEFIN_URL }, secondary: connections(c) };
    case 'token':
      return {
        action: { label: 'Reconnect', url: `${c.appUrl}/settings/connections` },
        secondary: { label: 'Get a token at SimpleFIN ↗', url: SIMPLEFIN_URL }
      };
    case 'plaid':
      return { action: { label: 'Reconnect', url: `${c.appUrl}/settings/connections` } };
    case 'admin':
      return { action: { label: 'See details', url: `${c.appUrl}/settings/connections` } };
    case 'wait':
      return { secondary: connections(c) };
  }
}

function steps(x: ConnectionIssue): string[] | undefined {
  if (x.fix === 'simplefin') return [`Sign in to ${x.bank ?? 'the bank'} again at SimpleFIN.`, 'Press Sync on any page in HTMFD.'];
  if (x.fix === 'token') return ['Make a new setup token at SimpleFIN.', 'Paste it in Settings › Connections.'];
  if (x.fix === 'plaid') return ['Open Settings › Connections.', `Press Reconnect beside ${x.bank ?? 'the bank'} and sign in.`];
  return undefined;
}

/** The provider's own words, without the instruction the banner appends. */
const providerWords = (x: ConnectionIssue) =>
  x.detail.replace(/\s*Update the sign-in at SimpleFIN, then sync here\.$/, '').trim();

/** The problem as a plain sentence, rather than SimpleFIN's error string. */
function plain(x: ConnectionIssue): string {
  const bank = x.bank ?? 'the bank';
  if (x.key === 'access')
    return 'The access was revoked or expired at SimpleFIN, so no bank can update. Your history is safe; only new transactions are paused.';
  if (x.key === 'no-credential')
    return 'No SimpleFIN connection is stored, so none of your accounts update. Your history is safe; only new transactions are paused.';
  if (x.fix === 'wait') return `${x.detail} You will get another email if it does not.`;
  if (x.key.startsWith('bank-')) {
    if (/credentials?.*(do not|don't) match|password|incorrect/i.test(x.detail))
      return `The password SimpleFIN has for ${bank} no longer matches the one at the bank, so nothing new is coming in.`;
    if (/one.?time|verification|mfa|security code|2fa/i.test(x.detail))
      return `${bank} wants a one-time code before it lets SimpleFIN in, so nothing new is coming in.`;
    if (/sign ?in|log ?in|re-?authenticat|credential/i.test(x.detail))
      return `${bank} needs you to sign in again at SimpleFIN before anything new comes in.`;
    return `SimpleFIN says: ${providerWords(x)}`;
  }
  return x.detail;
}

/** A reminder's heading: "X needs you to sign in again" → "X still needs you to sign in". */
const still = (title: string) =>
  title
    .replace(/ needs you to sign in again$/, ' still needs you to sign in')
    .replace(/ is not syncing$/, ' is still not syncing')
    .replace(/ has not updated /, ' still has not updated ')
    .replace(/ no longer accepts /, ' still does not accept ');

const since = (x: ConnectionIssue, c: Ctx) => (x.since ? c.now.getTime() - new Date(x.since).getTime() : null);

/** The 7-day strip: missed from the day it broke, good before. */
function strip(x: ConnectionIssue, c: Ctx, caption: string): MailDoc['timeline'] {
  if (!x.since) return undefined;
  const from = c.d.key(new Date(x.since));
  const days = c.d.days(c.now);
  return { kind: 'days', cells: days.map((k) => (k.key >= from ? 'miss' : 'good')), labels: days.map((k) => k.label), caption };
}

function one(x: ConnectionIssue, reminder: boolean, c: Ctx): { subject: string; doc: MailDoc } {
  const heading = reminder ? still(x.title) : x.title;
  const ms = since(x, c);
  const sinceDay = x.since ? c.d.day(new Date(x.since)) : null;
  const allDown = ALL_DOWN.has(x.key);
  const figure: MailDoc['figure'] = allDown
    ? c.banks.length
      ? { value: `0 of ${c.banks.length}`, unit: `banks updating${sinceDay ? ` since ${sinceDay}` : ''}` }
      : undefined
    : ms !== null
      ? { value: duration(ms), unit: `since ${sinceDay}` }
      : undefined;
  const next = c.d.day(new Date(c.now.getTime() + REMIND_AFTER));
  const caption = reminder
    ? `Open since ${sinceDay}. Next reminder ${next} if it is still open.`
    : x.lastGood
      ? `Last good sync ${c.d.long(new Date(x.lastGood))}.`
      : '';
  const preheader =
    x.fix === 'simplefin'
      ? reminder
        ? `Still not syncing after ${ms !== null ? duration(ms) : 'a while'}. It takes about a minute at SimpleFIN.`
        : `Nothing from ${x.bank ?? 'this bank'} has synced${sinceDay ? ` since ${sinceDay}` : ''}. Signing in again at SimpleFIN fixes it.`
      : x.fix === 'token'
        ? 'No bank can update until you paste a new setup token in Settings.'
        : plain(x);
  return {
    subject: reminder ? `Reminder: ${heading}` : heading,
    doc: {
      preheader,
      tone: reminder ? 'watch' : 'over',
      eyebrow: 'Connections',
      status: reminder ? 'Reminder · still open' : 'Needs you',
      heading,
      figure,
      meta: [x.bank && !heading.includes(x.bank) ? x.bank : null, sinceDay ? `Since ${sinceDay}` : null].filter(Boolean).join(' · ') || undefined,
      timeline: !allDown && x.fix === 'simplefin' ? strip(x, c, caption) : undefined,
      lead: reminder ? undefined : plain(x),
      steps: steps(x),
      ...actions(x, c),
      footer: FOOTER,
      settingsUrl: `${c.appUrl}/settings`
    }
  };
}

const PILL: Record<ConnectionIssue['fix'], string> = {
  simplefin: 'Sign in again',
  token: 'New token',
  wait: 'Waiting',
  admin: 'Server',
  plaid: 'Sign in again'
};

function several(issues: ConnectionIssue[], reminder: boolean, c: Ctx): { subject: string; doc: MailDoc } {
  const heading = `${issues.length} connections ${reminder ? 'still ' : ''}need you`;
  const oldest = Math.max(...issues.map((x) => since(x, c) ?? 0));
  const shared = issues.every((x) => x.fix === 'simplefin');
  const names = issues.map((x) => x.bank ?? x.title);
  const tone: MailTone = reminder ? 'watch' : 'over';
  const items: MailItem[] = issues.map((x) => {
    const ms = since(x, c);
    const meta = x.lastGood
      ? `For ${ms !== null ? duration(ms) : 'a while'} · last good sync ${c.d.day(new Date(x.lastGood))}`
      : x.since
        ? `Since ${c.d.day(new Date(x.since))} · ${duration(ms!)}`
        : undefined;
    return {
      monogram: x.bank ? initials(x.bank) : undefined,
      title: x.bank ?? x.title,
      meta,
      detail: x.bank ? providerWords(x) : plain(x),
      pill: PILL[x.fix],
      tone
    };
  });
  return {
    subject: reminder ? `Reminder: ${heading}` : heading,
    doc: {
      preheader: shared
        ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} stopped syncing. One fix at SimpleFIN covers ${issues.length === 2 ? 'both' : 'all of them'}.`
        : names.join(' · '),
      tone,
      eyebrow: 'Connections',
      status: reminder ? 'Reminder · still open' : 'Needs you',
      heading,
      figure: oldest > 0 ? { value: duration(oldest), unit: 'for the oldest' } : undefined,
      lead: shared ? 'Sign in to each bank again at SimpleFIN, then press Sync on any page.' : undefined,
      items,
      ...actions(issues[0], c),
      footer: FOOTER,
      settingsUrl: `${c.appUrl}/settings`
    }
  };
}

function fixed(state: AlertState, c: Ctx): MailDoc {
  const wasDown = (bank: string) => state.keys.includes(`bank-${slug(bank)}`) || state.keys.includes(`stale-${slug(bank)}`);
  const synced = c.lastSync ? c.d.when(c.lastSync, c.now) : null;
  return {
    preheader: 'Every bank synced cleanly on the last pass. Nothing needs you.',
    tone: 'ok',
    eyebrow: 'Connections',
    status: 'Fixed',
    heading: 'Connections are working again',
    figure: { value: c.banks.length ? `All ${c.banks.length}` : 'All', unit: 'banks syncing' },
    lead: 'Every bank synced cleanly on the last pass. Nothing needs you.',
    items: c.banks.length
      ? c.banks.map((b) => ({
          monogram: initials(b),
          title: b,
          meta: synced ? (wasDown(b) ? `Back · synced ${synced}` : `Synced ${synced}`) : wasDown(b) ? 'Back' : undefined,
          pill: 'Synced',
          tick: 'ok' as const
        }))
      : undefined,
    secondary: { label: 'Open HTMFD', url: c.appUrl },
    footer: FOOTER,
    settingsUrl: `${c.appUrl}/settings`
  };
}

const mail = (kind: AlertEmail['kind'], subject: string, doc: MailDoc, assetBase?: string): AlertEmail => ({
  kind,
  subject,
  ...renderEmail(doc, { subject, assetBase })
});

export function planAlert(
  all: ConnectionIssue[],
  state: AlertState,
  now: Date,
  appUrl: string,
  context: AlertContext = { banks: [], lastSync: null }
): { email: AlertEmail | null; next: AlertState } {
  const issues = all.filter((x) => x.key !== 'no-sync');
  const keys = issues.map((x) => x.key).sort();
  const fresh = issues.filter((x) => !state.keys.includes(x.key));
  const c: Ctx = { now, appUrl, banks: context.banks, lastSync: context.lastSync, d: mailDates(context.tz ?? MAIL_TZ) };

  if (fresh.length) {
    const m = fresh.length === 1 ? one(fresh[0], false, c) : several(fresh, false, c);
    const older = issues.filter((x) => state.keys.includes(x.key));
    if (older.length) m.doc.note = { tone: 'watch', lead: 'Still open from before:', text: `${older.map((x) => x.title).join('; ')}.` };
    return { email: mail('new', m.subject, m.doc, context.assetBase), next: { keys, at: now } };
  }

  if (issues.length && state.at && now.getTime() - state.at.getTime() >= REMIND_AFTER) {
    const m = issues.length === 1 ? one(issues[0], true, c) : several(issues, true, c);
    return { email: mail('reminder', m.subject, m.doc, context.assetBase), next: { keys, at: now } };
  }

  if (!issues.length && state.keys.length) {
    return { email: mail('resolved', 'Connections are working again', fixed(state, c), context.assetBase), next: { keys: [], at: now } };
  }

  // Unchanged. A problem that cleared and another that stays drop the cleared
  // key, so it is news again if it comes back.
  return { email: null, next: { keys: state.keys.filter((k) => keys.includes(k)), at: state.at } };
}
