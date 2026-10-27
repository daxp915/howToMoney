// Every email the app and the relay Worker send ($lib/emailFixtures), written
// to HTML + text files to look at; with --shots, screenshotted at 600 and 390,
// light and dark; with --send <address>, mailed through the relay Worker
// (needs FEEDBACK_WEBHOOK_URL/SECRET, so: node --env-file=.env).
//   npm run email:preview [-- --shots] [-- --local]   (OUT=dir, default: temp)
//   npm run email:send -- you@example.com              (subjects get "[Test] ")
// --local points the icons at workers/feedback/public/email/ instead of the
// hosted copies, for looking before the Worker is deployed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { EMAIL_KINDS, emailFixture } from '../src/lib/emailFixtures';

const args = process.argv.slice(2);
const OUT = process.env.OUT || join(tmpdir(), 'htmfd-email');
const local = args.includes('--local');
const to = args.includes('--send') ? args[args.indexOf('--send') + 1] : null;
const assetBase = local ? pathToFileURL(resolve('workers/feedback/public/email')).href + '/' : undefined;
mkdirSync(OUT, { recursive: true });

const mails = EMAIL_KINDS.map((k) => [k, emailFixture(k, new Date(), { assetBase })] as const);

if (to) {
  const url = (process.env.FEEDBACK_WEBHOOK_URL ?? '').replace(/\/+$/, '');
  const secret = process.env.FEEDBACK_WEBHOOK_SECRET ?? '';
  if (!url || !secret) throw new Error('FEEDBACK_WEBHOOK_URL/SECRET unset: run with node --env-file=.env');
  for (const [k, m] of mails) {
    const res = await fetch(`${url}/alert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-htm-secret': secret },
      body: JSON.stringify({ to, subject: `[Test] ${m.subject}`, text: m.text, html: m.html })
    });
    console.log(`${k.padEnd(12)} ${res.status} ${res.ok ? m.subject : await res.text()}`);
  }
  process.exit(0);
}

for (const [k, m] of mails) {
  writeFileSync(join(OUT, `${k}.html`), m.html);
  writeFileSync(join(OUT, `${k}.txt`), `Subject: ${m.subject}\n\n${m.text}`);
}
console.log(`${mails.length} emails in ${OUT}`);

if (args.includes('--shots')) {
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  for (const scheme of ['light', 'dark'] as const)
    for (const width of [600, 390]) {
      const ctx = await b.newContext({ viewport: { width, height: 800 }, colorScheme: scheme });
      const p = await ctx.newPage();
      for (const [k] of mails) {
        await p.goto(pathToFileURL(join(OUT, `${k}.html`)).href, { waitUntil: 'load' });
        await p.screenshot({ path: join(OUT, `${k}-${scheme}-${width}.png`), fullPage: true });
      }
      await ctx.close();
    }
  await b.close();
  console.log('screenshots written');
}
