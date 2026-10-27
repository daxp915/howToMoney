/**
 * One of every email, built through the real code paths (`connectionIssues()`
 * → `planAlert()`, and `$lib/relayMails`) from hand-built sync histories. For
 * looking, never for sending to anyone but a test address: the dev route
 * `/dev/email/<kind>`, `npm run email:preview` and `npm run email:send`.
 */
import { connectionIssues, type HealthRun } from './connectionHealth';
import { planAlert } from './alertPlan';
import { renderEmail, type RenderOptions } from './email';
import { backMail, downMail, reportMail } from './relayMails';

export const EMAIL_KINDS = ['new-one', 'new-several', 'new-token', 'reminder', 'resolved', 'down', 'back', 'report'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

const APP = 'https://money.example.com';
const H = 36e5;

export function emailFixture(kind: EmailKind, now = new Date(), opts: RenderOptions = {}): { subject: string; html: string; text: string } {
  const ago = (h: number) => new Date(now.getTime() - h * H);
  const run = (h: number, status: string, error: string | null = null): HealthRun => ({
    startedAt: ago(h),
    finishedAt: ago(h),
    status,
    error
  });
  const lenderError =
    'Connection to Harbor Auto Finance may need attention. The credentials entered do not match your credentials at this institution.';
  // Every six hours for a week; Harbor Auto failing for the last ~2 days.
  const runs = Array.from({ length: 28 }, (_, i) => run(i * 6 + 1, i < 8 ? 'completed_with_errors' : 'completed', i < 8 ? lenderError : null));
  const accounts = [
    { orgName: 'Maple Bank (US)', balanceDate: ago(5) },
    { orgName: 'Harbor Auto Finance', balanceDate: ago(50) },
    { orgName: 'Pinecrest Bank', balanceDate: ago(5) }
  ];
  const ctx = { banks: ['Pinecrest Bank', 'Maple Bank', 'Harbor Auto Finance'], lastSync: ago(1), assetBase: opts.assetBase };
  const base = { now, hasCredential: true, runs, accounts };
  const empty = { keys: [] as string[], at: null };
  const alert = (e: ReturnType<typeof planAlert>['email']) => {
    if (!e) throw new Error(`${kind}: no email planned`);
    return { subject: e.subject, html: e.html, text: e.text };
  };
  const relay = (m: { subject: string; doc: Parameters<typeof renderEmail>[0] }) => ({
    subject: m.subject,
    ...renderEmail(m.doc, { ...opts, subject: m.subject })
  });

  switch (kind) {
    case 'new-one':
      return alert(planAlert(connectionIssues(base), empty, now, APP, ctx).email);
    case 'new-several': {
      const issues = connectionIssues({ ...base, accounts: [...accounts, { orgName: 'Chase Bank', balanceDate: ago(6 * 24 + 3) }] });
      return alert(planAlert(issues, empty, now, APP, { ...ctx, banks: [...ctx.banks, 'Chase'] }).email);
    }
    case 'new-token': {
      const issues = connectionIssues({ ...base, runs: [run(1, 'failed', 'SimpleFIN rejected the access URL (403).'), ...runs.slice(8)] });
      return alert(planAlert(issues, empty, now, APP, ctx).email);
    }
    case 'reminder': {
      const later = new Date(now.getTime() + 3 * 24 * H);
      const issues = connectionIssues({ ...base, now: later });
      return alert(planAlert(issues, { keys: issues.map((x) => x.key), at: now }, later, APP, ctx).email);
    }
    case 'resolved':
      return alert(planAlert([], { keys: ['bank-lenderError-financial'], at: ago(30) }, now, APP, ctx).email);
    case 'down':
      return relay(downMail(APP, ago(4.2).toISOString(), now));
    case 'back':
      return relay(backMail(APP, ago(6.3).toISOString(), now));
    case 'report':
      return relay(
        reportMail(
          {
            userId: 'a1b2c3',
            email: 'demo@example.com',
            kind: 'wrong',
            message: 'The Costco charge from Saturday shows up twice in Activity, once pending and once posted. Groceries now says I am $96 over.',
            page: '/transactions?m=2026-10',
            context: { browser: 'iPhone · Safari', lastSync: ago(1).toISOString(), accounts: { total: 9, active: 9 } }
          },
          APP,
          now
        )
      );
  }
}
