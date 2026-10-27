// Connection alerts against hand-built sync histories. Pure: no database.
//   npm run test:health
import { connectionIssues, type HealthRun } from '../src/lib/connectionHealth';
import { planAlert } from '../src/lib/alertPlan';
import { renderEmail } from '../src/lib/email';
import { backMail, downMail, reportMail } from '../src/lib/relayMails';

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} :: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
}

const now = new Date('2026-10-05T15:00:00Z');
const at = (iso: string) => new Date(iso);
const run = (iso: string, status: string, error: string | null = null): HealthRun => ({
  startedAt: at(iso),
  finishedAt: status === 'running' ? null : at(iso),
  status,
  error
});
const fresh = [
  { orgName: 'Maple Bank (US)', balanceDate: at('2026-10-04T14:46:50Z') },
  { orgName: 'Harbor Auto Finance', balanceDate: at('2026-10-02T22:39:36Z') }
];
const base = { now, hasCredential: true, accounts: fresh };
const lenderError =
  'Connection to Harbor Auto Finance may need attention. The credentials entered do not match your credentials at this institution.';
const advisory = 'Requested date range exceeds recommended range of 45 days';

// What prod looked like on 2026-10-05: five runs reporting one lender, the app silent.
const prod = connectionIssues({
  ...base,
  runs: [
    run('2026-10-05T14:15:00Z', 'completed_with_errors', lenderError),
    run('2026-10-05T08:58:00Z', 'completed_with_errors', lenderError),
    run('2026-10-05T02:58:00Z', 'completed_with_errors', lenderError),
    run('2026-10-04T20:58:00Z', 'completed_with_errors', lenderError),
    run('2026-10-04T14:58:00Z', 'completed_with_errors', lenderError),
    run('2026-10-04T08:58:00Z', 'completed')
  ]
});
check('lender sign-in: one issue', prod.map((x) => [x.key, x.bank, x.fix]), [['bank-harbor-auto-finance', 'Harbor Auto Finance', 'simplefin']]);
check('says to sign in again', prod[0].title, 'Harbor Auto Finance needs you to sign in again');
check('since the first run that reported it', prod[0].since?.toISOString(), '2026-10-04T14:58:00.000Z');

check('a clean run: nothing', connectionIssues({ ...base, runs: [run('2026-10-05T14:00:00Z', 'completed')] }), []);
check(
  'a date-range advisory is not a problem',
  connectionIssues({ ...base, runs: [run('2026-10-05T14:00:00Z', 'completed', advisory)] }),
  []
);
check(
  'advisory beside a real error: only the error',
  connectionIssues({ ...base, runs: [run('2026-10-05T14:00:00Z', 'completed_with_errors', `${advisory}; ${lenderError}`)] }).map((x) => x.key),
  ['bank-harbor-auto-finance']
);
check(
  'a sync in progress does not hide the last answer',
  connectionIssues({
    ...base,
    runs: [run('2026-10-05T14:59:00Z', 'running'), run('2026-10-05T14:00:00Z', 'completed_with_errors', lenderError)]
  }).map((x) => x.key),
  ['bank-harbor-auto-finance']
);

const revoked = connectionIssues({
  ...base,
  runs: [run('2026-10-05T14:00:00Z', 'failed', 'SimpleFIN rejected the access URL (403). The connection may need re-auth.')]
});
check('403: a new setup token', revoked.map((x) => [x.key, x.fix]), [['access', 'token']]);

const key = connectionIssues({
  ...base,
  runs: [
    run('2026-10-05T14:00:00Z', 'failed', 'Stored credential failed authentication — either ENCRYPTION_KEY changed or the row was altered.')
  ]
});
check('unreadable credential: the server', key.map((x) => [x.key, x.fix]), [['key', 'admin']]);

const timeout = 'SimpleFIN did not respond within 120s while fetching accounts.';
check(
  'one timeout is a blip',
  connectionIssues({ ...base, runs: [run('2026-10-05T14:00:00Z', 'failed', timeout), run('2026-10-05T08:00:00Z', 'completed')] }),
  []
);
check(
  'two in a row is an outage',
  connectionIssues({
    ...base,
    runs: [
      run('2026-10-05T14:00:00Z', 'failed', timeout),
      run('2026-10-05T08:00:00Z', 'failed', timeout),
      run('2026-10-05T02:00:00Z', 'completed')
    ]
  }).map((x) => [x.key, x.fix, x.since?.toISOString()]),
  [['down', 'wait', '2026-10-05T08:00:00.000Z']]
);

check(
  'no run for a day and a half: the worker',
  connectionIssues({ ...base, runs: [run('2026-10-04T02:00:00Z', 'completed')] }).map((x) => [x.key, x.fix]),
  [['no-sync', 'admin']]
);

check(
  'credential removed with accounts left',
  connectionIssues({ ...base, hasCredential: false, runs: [] }).map((x) => [x.key, x.fix]),
  [['no-credential', 'token']]
);
check('never connected: nothing to fix', connectionIssues({ now, hasCredential: false, runs: [], accounts: [] }), []);

const quiet = connectionIssues({
  ...base,
  accounts: [...fresh, { orgName: 'Chase Bank', balanceDate: at('2026-09-29T10:00:00Z') }],
  runs: [run('2026-10-05T14:00:00Z', 'completed')]
});
check('a bank silent for 6 days with no error', quiet.map((x) => [x.key, x.bank, x.title]), [
  ['stale-chase', 'Chase', 'Chase has not updated since Sep 29']
]);
check(
  'a stale bank already reported is one issue, not two',
  connectionIssues({
    ...base,
    accounts: [{ orgName: 'Harbor Auto Finance', balanceDate: at('2026-09-20T00:00:00Z') }],
    runs: [run('2026-10-05T14:00:00Z', 'completed_with_errors', lenderError)]
  }).map((x) => x.key),
  ['bank-harbor-auto-finance']
);
check(
  'a bank with one fresh account is not stale',
  connectionIssues({
    ...base,
    accounts: [
      { orgName: 'Pinecrest Bank', balanceDate: at('2026-09-01T00:00:00Z') },
      { orgName: 'Pinecrest Bank', balanceDate: at('2026-10-04T17:00:00Z') }
    ],
    runs: [run('2026-10-05T14:00:00Z', 'completed')]
  }),
  []
);

// ---- planAlert: which email, if any ----
const URL_ = 'https://money.example.com';
const kind = (r: ReturnType<typeof planAlert>) => r.email?.kind ?? null;
const t0 = new Date('2026-10-05T15:00:00Z');
const later = (h: number) => new Date(t0.getTime() + h * 36e5);
const empty = { keys: [] as string[], at: null };
const ctx = { banks: ['Maple Bank', 'Harbor Auto Finance'], lastSync: at('2026-10-05T14:15:00Z') };

const first = planAlert(prod, empty, t0, URL_, ctx);
check('a new problem is mailed', kind(first), 'new');
check('subject names it, no prefix', first.email?.subject, 'Harbor Auto Finance needs you to sign in again');
check('body links SimpleFIN and Connections', /beta-bridge\.simplefin\.org[\s\S]*money.example.com\/settings\/connections/.test(first.email?.text ?? ''), true);
check('the next sync, same problem: silent', kind(planAlert(prod, first.next, later(6), URL_, ctx)), null);
const remind = planAlert(prod, first.next, later(72), URL_, ctx);
check('three days on: a reminder', [kind(remind), remind.email?.subject], ['reminder', 'Reminder: Harbor Auto Finance still needs you to sign in']);
check('a reminder says when the next one comes', /Next reminder Oct 11 if it is still open/.test(remind.email?.html ?? ''), true);
check('a reminder is yellow, never red', [/#ffecc1/.test(remind.email?.html ?? ''), /#ffe5e1/.test(remind.email?.html ?? '')], [true, false]);
const fixed = planAlert([], first.next, later(12), URL_, ctx);
check('fixed: one email saying so', [kind(fixed), fixed.email?.subject], ['resolved', 'Connections are working again']);
check('fixed: every bank listed, the one that was down says back', /Back · synced today, 10:15 AM/.test(fixed.email?.text ?? ''), true);
check('then silence', kind(planAlert([], fixed.next, later(18), URL_, ctx)), null);
check('nothing ever wrong: nothing sent', kind(planAlert([], empty, t0, URL_, ctx)), null);
const both = connectionIssues({ ...base, accounts: [...fresh, { orgName: 'Chase Bank', balanceDate: at('2026-09-29T10:00:00Z') }], runs: [run('2026-10-05T14:15:00Z', 'completed_with_errors', lenderError)] });
const second = planAlert(both, first.next, later(6), URL_, ctx);
check('a second bank breaking is news', [kind(second), second.email?.subject], ['new', 'Chase has not updated since Sep 29']);
check('and mentions the one still open', /Still open from before: Harbor Auto/.test(second.email?.text ?? ''), true);
check(
  '"no sync" is never mailed by the worker (the heartbeat covers it)',
  kind(planAlert(connectionIssues({ ...base, runs: [run('2026-10-04T02:00:00Z', 'completed')] }), empty, t0, URL_, ctx)),
  null
);

// ---- the email itself ----
/** The button's link. */
const BUTTON = /class="e-btn-a"/g;
const html = first.email?.html ?? '';
check('html: the problem is the heading', /<h1[^>]*>Harbor Auto Finance needs you to sign in again<\/h1>/.test(html), true);
check('html: one button, to SimpleFIN', [html.match(BUTTON)?.length, /href="https:\/\/beta-bridge\.simplefin\.org\/" class="e-btn-a"/.test(html)], [1, true]);
check('html: the duration as the hero figure', /class="e-fig"[^>]*>1 day<\/span>[\s\S]{0,200}since Oct 4/.test(html), true);
check('html: the provider error as a plain sentence', /The password SimpleFIN has for Harbor Auto Finance no longer matches/.test(html), true);
check('html: last good sync under the strip', /Last good sync Sunday, Oct 4 at 4:58 AM\./.test(html), true);
check('html: a 7-day strip ending today', (html.match(/class="e-dot /g) ?? []).length + (html.match(/>Today</g) ?? []).length, 8);
check('html: footer links Settings', /href="https:\/\/money.example.com\/settings" class="e-link"[^>]*>Email settings/.test(html), true);
check('html: dark mode and phone sizes', /prefers-color-scheme: dark[\s\S]*max-width: 480px/.test(html), true);
check(
  'html: a bank message is escaped, never markup',
  renderEmail({ preheader: '', tone: 'over', eyebrow: 'x', heading: '<b>x</b>', footer: '' }).html.includes('&lt;b&gt;x&lt;/b&gt;'),
  true
);
check('text part says the same', /Fix at SimpleFIN ↗: https:\/\/beta-bridge/.test(first.email?.text ?? ''), true);
const two = planAlert(both, empty, t0, URL_, ctx).email;
check(
  'several problems: bank rows under a count, one button',
  [two?.subject, /Harbor Auto Finance[\s\S]*Chase/.test(two?.html ?? ''), (two?.html.match(BUTTON) ?? []).length, /One fix at SimpleFIN covers both/.test(two?.html ?? '')],
  ['2 connections need you', true, 1, true]
);
check('resolved: no red in it', /#de3b3d/.test(fixed.email?.html ?? ''), false);
const token = planAlert(revoked, empty, t0, URL_, ctx).email;
check('revoked: no bank updating, Reconnect', [/>0 of 2</.test(token?.html ?? ''), /class="e-btn-a"[^>]*>Reconnect</.test(token?.html ?? '')], [true, true]);

// ---- Plaid banks ----
const plaidRun = run('2026-10-05T14:00:00Z', 'completed_with_errors', 'Tartan Bank: the login details of this item have changed [plaid ITEM_LOGIN_REQUIRED]');
const relogin = connectionIssues({
  ...base,
  runs: [plaidRun],
  plaid: [{ id: 'p1', bank: 'Tartan Bank', errorCode: 'ITEM_LOGIN_REQUIRED', lastGood: new Date('2026-10-04T14:00:00Z') }]
});
check(
  'plaid sign-in: one issue, Reconnect, not a second copy from the run',
  relogin.map((x) => [x.key, x.fix, x.title]),
  [['plaid-tartan-bank-item_login_required', 'plaid', 'Tartan Bank needs you to sign in again']]
);
check(
  'plaid other error: wait, not a sign-in',
  connectionIssues({ ...base, runs: [run('2026-10-05T14:00:00Z', 'completed')], plaid: [{ id: 'p1', bank: 'Tartan Bank', errorCode: 'INSTITUTION_DOWN', lastGood: null }] }).map((x) => x.fix),
  ['wait']
);
check('plaid only: no "disconnected" banner', connectionIssues({ ...base, hasCredential: true, runs: [run('2026-10-05T14:00:00Z', 'completed')], plaid: [] }), []);
const plaidMail = planAlert(relogin, empty, t0, URL_, ctx).email;
check('plaid email: Reconnect button and steps', [/class="e-btn-a"[^>]*>Reconnect</.test(plaidMail?.html ?? ''), /Press Reconnect beside Tartan Bank/.test(plaidMail?.html ?? '')], [true, true]);

// ---- the Worker's own emails ----
const nowW = new Date('2026-10-07T15:30:00Z');
const down = downMail(URL_, '2026-10-07T11:30:00Z', nowW);
check('down: 4 hours since the last heartbeat', [down.doc.figure, down.doc.timeline?.cells.filter((x) => x === 'quiet').length], [{ value: '4 hours', unit: 'since 7:30 AM EDT' }, 8]);
const back = backMail(URL_, '2026-10-07T09:30:00Z', nowW);
check('back: quiet 6 hours, the last block green', [back.doc.figure?.value, back.doc.timeline?.cells.at(-1)], ['6 hours', 'back']);
const rep = reportMail({ kind: 'idea', message: 'x', page: '/plan', email: 'a@b.c' }, URL_, nowW);
check('report: subject, sender, link to the page', [rep.subject, rep.doc.context?.[1][1], rep.doc.secondary?.url], ['Report: An idea', 'a@b.c', 'https://money.example.com/plan']);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
