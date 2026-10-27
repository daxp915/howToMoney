// The Advisor from the command line: prints the checkup, and answers a
// question through the same path the page uses (tools, model, stored turn).
//
//   npm run advisor                               checkup only
//   npm run advisor -- "Can I afford an $800 TV?" and a question
//   npm run advisor -- you@example.com "..."      with several users
//
// A question costs a few cents of model time; the checkup costs nothing.
import 'dotenv/config';
import { runAsUser } from '../src/lib/server/db';
import { runCheckup } from '../src/lib/server/advisor/facts';
import { answering, askAdvisor, getConversation } from '../src/lib/server/advisor/agent';
import { formatFig, renderPlain } from '../src/lib/advisor/figures';
import { resolveUserArg } from './lib/whose';

const args = process.argv.slice(2);
const email = args[0]?.includes('@') ? args.shift() : undefined;
const question = args.join(' ').trim();

async function main() {
  const user = await resolveUserArg(email);

  const c = await runAsUser(user.id, runCheckup);
  console.log(`Checkup -- ${c.basis}`);
  for (const f of c.findings) {
    const ctx = f.context ? `  -- ${renderPlain({ text: f.context, figures: f.figures })}` : '';
    console.log(`  ${f.emoji} [${f.severity}] ${renderPlain(f)}${ctx}`);
  }
  if (c.hidden.length) console.log(`  (${c.hidden.length} hidden)`);
  if (!c.findings.length) console.log('  All clear.');
  for (const n of c.notes) console.log(`  note: ${n}`);
  if (!question) return;

  console.log(`\nQ: ${question}`);
  const { conversationId } = await runAsUser(user.id, () => askAdvisor(user.id, question, null));
  let last = '';
  while (answering(user.id)) {
    const conv = await runAsUser(user.id, () => getConversation(user.id, conversationId));
    const step = conv?.turns.at(-1)?.steps?.at(-1);
    const p = step ? `${step.done ? 'done' : '...'} ${step.label}` : '';
    if (p && p !== last) console.log(`  ${p}`);
    last = p;
    await new Promise((r) => setTimeout(r, 750));
  }

  const conv = await runAsUser(user.id, () => getConversation(user.id, conversationId));
  const turn = conv?.turns.at(-1);
  if (!turn?.answer) {
    console.log(`\nNo answer: ${turn?.error ?? 'unknown'}`);
    process.exitCode = 1;
    return;
  }
  const a = turn.answer;
  if (a.verdict) console.log(`\n[${a.verdict.tone}] ${renderPlain({ text: a.verdict.label, figures: a.figures })}`);
  console.log(`\n${renderPlain({ text: a.prose, figures: a.figures })}`);
  console.log(`\nRests on (${a.shape}):`);
  for (const e of a.evidence) {
    const f = a.figures[e.id];
    console.log(`  ${e.label}: ${formatFig(f)}${e.sub ? ` (${e.sub})` : ''}${f.href ? `  -> ${f.href}` : ''}`);
  }
  for (const g of a.gaps) console.log(`  missing: ${g.title} -- ${g.detail}`);
  if (a.followups.length) console.log(`\nNext: ${a.followups.join(' | ')}`);
  console.log(`\n${a.basis}`);
  if (a.payload) console.log(`payload: ${JSON.stringify(a.payload).slice(0, 300)}`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
