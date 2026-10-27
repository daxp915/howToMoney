<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import Btn from '$lib/components/ui/Btn.svelte';
  import MaskedText from '$lib/components/MaskedText.svelte';
  import Rich from './Rich.svelte';
  import Figure from './Figure.svelte';
  import AffordShape from './AffordShape.svelte';
  import DebtShape from './DebtShape.svelte';
  import GoalShape from './GoalShape.svelte';
  import CutShape from './CutShape.svelte';
  import FigureRows from './FigureRows.svelte';
  import { provideOpener, type Zone } from './figureOpen';
  import type { Fig } from '$lib/advisor/figures';
  import { act } from '$lib/client/act';
  import { toast } from '$lib/toast.svelte';
  import { goalHref, type AdvisorAction, type AffordPayload, type Answer, type CutPayload, type DebtPayload, type GoalPayload } from '$lib/advisor/answer';

  /**
   * One answer card (handoff 7b-7j): verdict chip, the prose, what it rests
   * on, the block its shape draws, and where it came from. The prose is the
   * model's; every figure in it and around it is the app's, rendered as its
   * own element so it masks and links.
   */
  let { answer, onask }: { answer: Answer; onask?: (q: string) => void } = $props();

  const VERDICT_ICON = { yes: 'check', wait: 'clock', no: 'ban', unknown: null } as const;
  const afford = $derived(answer.shape === 'afford' ? (answer.payload as AffordPayload | null) : null);

  // One figure open at a time, its rows under the block it sits in.
  // Tapping it again closes it; tapping another moves the card.
  // Compared by what the figure is, not by object: a shape builds its
  // figures inline, and a prop expression is re-evaluated on every read.
  let opened = $state<{ fig: Fig; zone: Zone; key: string } | null>(null);
  const keyOf = (f: Fig) => `${f.href}|${f.value}`;
  // A budget action sets the envelope where it stands, with Undo; a goal
  // action opens Plan's new-goal form filled in, because a goal snapshots an
  // account's balance and that choice is theirs to confirm.
  let setState = $state<Record<string, 'busy' | 'done'>>({});
  const money = (v: number): Fig => ({ kind: 'money', value: v });
  async function setBudget(a: Extract<AdvisorAction, { kind: 'budget' }>) {
    setState[a.categoryId] = 'busy';
    try {
      await act('set', { categoryId: a.categoryId, amount: String(a.amount) }, { path: '/plan', refresh: false });
      setState[a.categoryId] = 'done';
      toast.show(`${a.category} budget set`, async () => {
        await act('set', { categoryId: a.categoryId, amount: String(a.current ?? 0) }, { path: '/plan', refresh: false });
        delete setState[a.categoryId];
      });
    } catch (e) {
      delete setState[a.categoryId];
      toast.show(e instanceof Error ? e.message : String(e));
    }
  }

  provideOpener({
    isOpen: (fig) => opened?.key === keyOf(fig),
    toggle: (fig, zone) => (opened = opened?.key === keyOf(fig) ? null : { fig, zone, key: keyOf(fig) })
  });
</script>

<div class="answer">
  {#if answer.verdict}
    <div class="v-row" data-zone="prose">
      <span class="verdict {answer.verdict.tone}">
        {#if VERDICT_ICON[answer.verdict.tone]}
          <Icon name={VERDICT_ICON[answer.verdict.tone]!} size={15} stroke={2.75} />
        {/if}
        <Rich text={answer.verdict.label} figures={answer.figures} />
      </span>
      {#if afford}<span class="assume desk-inline">Assumes it's paid from {afford.account}</span>{/if}
    </div>
  {/if}

  <p class="prose" data-zone="prose"><Rich text={answer.prose} figures={answer.figures} /></p>
  {#if opened?.zone === 'prose'}<FigureRows fig={opened.fig} />{/if}

  {#if answer.shape === 'missing' && answer.gaps.length}
    <div class="missing">
      <div class="eyebrow">What's missing</div>
      {#each answer.gaps as g (g.key)}
        <div class="gap">
          <span class="g-emoji" aria-hidden="true">{g.emoji}</span>
          <div>
            <div class="g-title"><MaskedText text={g.title} /></div>
            <div class="g-detail"><MaskedText text={g.detail} /></div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <div class="zone" data-zone="shape">
    {#if answer.shape === 'cut' && answer.payload}
      <CutShape payload={answer.payload as CutPayload} />
    {/if}
    {#if answer.shape === 'goal' && answer.payload}
      <GoalShape payload={answer.payload as GoalPayload} />
    {/if}
    {#if answer.shape === 'debt' && answer.payload}
      <DebtShape payload={answer.payload as DebtPayload} />
    {/if}
  </div>
  {#if opened?.zone === 'shape' && !afford}<FigureRows fig={opened.fig} />{/if}

  {#if answer.evidence.length && answer.shape !== 'missing'}
    <div class="rests" data-zone="tiles">
      <div class="eyebrow rests-label">What this rests on</div>
      <div class="tiles" style="--n: {answer.evidence.length}">
        {#each answer.evidence as e (e.id)}
          <div class="tile">
            <div class="t-label"><MaskedText text={e.label} /></div>
            <Figure fig={answer.figures[e.id]} />
            {#if e.sub}<div class="t-sub"><MaskedText text={e.sub} /></div>{/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if opened?.zone === 'tiles'}<FigureRows fig={opened.fig} />{/if}

  {#if afford}
    <div class="zone" data-zone="shape"><AffordShape payload={afford} /></div>
    {#if opened?.zone === 'shape'}<FigureRows fig={opened.fig} />{/if}
  {/if}

  {#if answer.shape === 'missing' && answer.followups.length}
    <div class="can">
      <div class="eyebrow">It can answer these now</div>
      <div class="chips">
        {#each answer.followups as q (q)}
          <button type="button" class="chip" onclick={() => onask?.(q)}><MaskedText text={q} /></button>
        {/each}
      </div>
    </div>
  {/if}

  {#if answer.actions?.length}
    <div class="next">
      <div class="eyebrow">Next step</div>
      {#each answer.actions as a (a.kind + (a.kind === 'goal' ? a.name : a.categoryId))}
        <div class="act">
          <div class="a-text">
            {#if a.kind === 'goal'}
              <div class="a-title">
                Make it a goal: <MaskedText text={a.name} />, <Figure fig={money(a.amount)} />{#if a.date}{' '}by {new Date(a.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}{/if}
              </div>
            {:else}
              <div class="a-title">
                Budget <Figure fig={money(a.amount)} /> a month for <MaskedText text={a.category} />
                {#if a.current}<span class="a-now">(now <Figure fig={money(a.current)} />)</span>{/if}
              </div>
            {/if}
            {#if a.why}<div class="a-why"><MaskedText text={a.why} /></div>{/if}
          </div>
          {#if a.kind === 'goal'}
            <Btn variant="soft" size="sm" href={goalHref(a)}>Set up goal</Btn>
          {:else if setState[a.categoryId] === 'done'}
            <Btn variant="ghost" size="sm" href="/plan">Budget set ›</Btn>
          {:else}
            <Btn variant="soft" size="sm" disabled={setState[a.categoryId] === 'busy'} onclick={() => setBudget(a)}>
              {a.current ? 'Change budget' : 'Set budget'}
            </Btn>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <div class="foot">
    <div>{answer.basis}{#if afford}{' '}<a class="floor-link" href="/settings">Floor is set in Settings.</a>{/if}</div>
    {#if answer.shape === 'invest'}
      <div class="disclaim">
        <Icon name="info" size={14} stroke={2.75} />General guidance, not a recommendation to buy or sell anything specific.
      </div>
    {/if}
  </div>
</div>

<style>
  /* A wrapper only so a figure can tell which block it is in. */
  .zone {
    display: contents;
  }

  .answer {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 28px;
    padding: 26px 28px 22px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    line-height: normal;
  }
  .v-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .verdict {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 14px 6px 11px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 700;
  }
  .verdict.yes {
    background: var(--color-sage-100);
    color: var(--color-sage-700);
  }
  .verdict.wait {
    background: var(--color-inset);
    color: var(--color-chip-neutral-fg);
  }
  .verdict.no {
    background: var(--color-accent-100);
    color: var(--color-accent-800);
  }
  .verdict.unknown {
    background: var(--color-inset);
    color: var(--color-chip-neutral-fg);
    padding: 6px 14px;
  }
  .assume {
    font-size: 13px;
    color: var(--color-muted);
  }
  .prose {
    margin: 0;
    font-size: 16px;
    line-height: 1.6;
    max-width: 640px;
    text-wrap: pretty;
  }
  .eyebrow {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }
  .rests,
  .can {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    gap: 10px;
  }
  .tile {
    padding: 12px 16px;
    border-radius: 18px;
    background: var(--color-inset);
    min-width: 0;
  }
  .tile :global(.fig) {
    display: inline-block;
    font-size: 15px;
    margin-top: 3px;
  }
  .t-label {
    font-size: 12.5px;
    color: var(--color-muted);
  }
  .t-sub {
    font-size: 12px;
    color: var(--color-muted);
    margin-top: 2px;
  }
  .next {
    display: flex;
    flex-direction: column;
  }
  .next .eyebrow {
    padding-bottom: 6px;
  }
  .act {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 11px 0;
    border-top: 1px solid var(--color-rule);
  }
  .a-text {
    min-width: 0;
  }
  .a-title {
    font-size: 14.5px;
    font-weight: 600;
  }
  .a-now,
  .a-why {
    font-size: 12.5px;
    font-weight: 400;
    color: var(--color-muted);
  }
  .act :global(.btn2) {
    flex: 0 0 auto;
  }
  .missing {
    display: flex;
    flex-direction: column;
  }
  .missing .eyebrow {
    padding-bottom: 6px;
  }
  .gap {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    padding: 11px 0;
    border-top: 1px solid var(--color-rule);
  }
  .g-emoji {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--color-inset);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
  }
  .g-title {
    font-size: 14.5px;
    font-weight: 600;
  }
  .g-detail {
    font-size: 12.5px;
    color: var(--color-muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    all: unset;
    cursor: pointer;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-text-2);
  }
  .chip:hover {
    background: var(--color-accent-100);
  }
  .floor-link {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .floor-link:hover {
    color: var(--color-accent-700);
  }

  .foot {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12.5px;
    color: var(--color-muted);
    padding-top: 14px;
    border-top: 1px solid var(--color-rule);
    line-height: 1.5;
  }
  .disclaim {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  @media (max-width: 760px) {
    .answer {
      padding: 20px;
      gap: 16px;
    }
    .desk-inline,
    .rests-label {
      display: none;
    }
    .verdict {
      align-self: flex-start;
    }
    .prose {
      line-height: 1.55;
    }
    .tiles {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .tile {
      padding: 11px 14px;
    }
    .t-label {
      font-size: 12px;
    }
    .tile :global(.fig) {
      margin-top: 2px;
    }
  }
</style>
