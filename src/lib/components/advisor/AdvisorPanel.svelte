<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { advisor } from '$lib/advisor.svelte';
  import Answer from './Answer.svelte';
  import MaskedText from '$lib/components/MaskedText.svelte';
  import Rich from './Rich.svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import { phone } from '$lib/media.svelte';
  import type { Answer as AnswerT } from '$lib/advisor/answer';
  import type { Finding } from '$lib/advisor/checkup';

  /**
   * The Advisor layer: a 460px panel docked right on desktop, the
   * page behind it still usable; a sheet on a phone. It opens on the screen's
   * checkup and suggestions, carries "Looking at <screen>" as context, and
   * answers in place -- every underlined figure opens its transactions.
   */
  let { context, suggestions }: { context: string; suggestions: string[] } = $props();

  type Turn = {
    id: string;
    question: string;
    status: string;
    answer: AnswerT | null;
    steps: { label: string }[] | null;
    error: string | null;
  };
  type Conv = { id: string; title: string; updatedAt?: string };

  let view = $state<'start' | 'conv' | 'history'>('start');
  let conversationId = $state<string | null>(null);
  let turns = $state<Turn[]>([]);
  let answering = $state(false);
  let input = $state('');
  let error = $state<string | null>(null);
  let findings = $state<Finding[] | null>(null);
  let history = $state<Conv[]>([]);
  let field = $state<HTMLInputElement | null>(null);
  let poll: ReturnType<typeof setTimeout> | undefined;

  // A new open with a question starts over; ⌘K with none keeps the thread.
  let lastSeq = 0;
  $effect(() => {
    const s = advisor.seq;
    if (!advisor.open || s === lastSeq) return;
    lastSeq = s;
    if (advisor.question) {
      input = advisor.question;
      if (advisor.autoSend) {
        conversationId = null;
        turns = [];
        ask();
      }
    }
    loadStart();
    setTimeout(() => field?.focus(), 50);
  });

  async function loadStart() {
    try {
      const r = await fetch('/api/advisor');
      if (!r.ok) return;
      const j = await r.json();
      findings = j.checkup?.findings ?? [];
      history = j.conversations ?? [];
    } catch {
      // The checkup is a nicety here; asking still works.
    }
  }

  async function ask(q = input) {
    const question = q.trim();
    if (!question || answering) return;
    error = null;
    input = '';
    view = 'conv';
    answering = true;
    turns = [...turns, { id: 'pending', question, status: 'pending', answer: null, steps: [], error: null }];
    try {
      const r = await fetch('/api/advisor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, conversationId, context })
      });
      if (!r.ok) {
        // SvelteKit's error() body is JSON; its message is the sentence to show.
        const body = (await r.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message || 'The Advisor is busy. Try again in a moment.');
      }
      const ids = await r.json();
      conversationId = ids.conversationId;
      watch();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      answering = false;
      turns = turns.filter((t) => t.id !== 'pending');
      input = question;
    }
  }

  async function watch() {
    clearTimeout(poll);
    if (!conversationId) return;
    try {
      const r = await fetch(`/api/advisor/${conversationId}`);
      if (r.ok) {
        const c = await r.json();
        turns = c.turns;
        answering = c.answering;
      }
    } catch {
      // A dropped poll is retried.
    }
    if (answering) poll = setTimeout(watch, 1500);
  }

  async function openConv(id: string) {
    conversationId = id;
    view = 'conv';
    turns = [];
    await watch();
  }

  function fresh() {
    clearTimeout(poll);
    conversationId = null;
    turns = [];
    answering = false;
    view = 'start';
  }

  const last = $derived(turns[turns.length - 1]);
  const followups = $derived(last?.answer?.followups ?? []);
  const chips = $derived(view === 'conv' && followups.length ? followups.slice(0, 2) : suggestions.slice(0, 2));
  const top = $derived(findings?.find((f) => f.severity !== 'good') ?? null);
  const good = $derived(findings?.find((f) => f.severity === 'good') ?? null);

  // A figure in an answer is a link: follow it on the page behind the panel
  // (desktop), or close the sheet first (phone).
  function onFigureClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a || !a.getAttribute('href')?.startsWith('/')) return;
    if (phone.current) {
      e.preventDefault();
      advisor.hide();
      goto(a.getAttribute('href')!);
    }
  }
</script>

{#snippet body()}
  <div class="adv" onclickcapture={onFigureClick} role="presentation">
    <header class="head">
      {#if view === 'start'}
        <span class="title">Advisor</span>
      {:else}
        <button type="button" class="link" onclick={fresh}>‹ Advisor</button>
      {/if}
      <span class="head-right">
        <button type="button" class="link quiet" onclick={() => ((view = 'history'), loadStart())}>History</button>
        {#if !phone.current}
          <button type="button" class="x" aria-label="Close the Advisor" onclick={() => advisor.hide()}>×</button>
        {/if}
      </span>
    </header>

    <div class="scroll">
      {#if view === 'history'}
        <div class="section-label">Past questions</div>
        <div class="hist">
          {#each history as c (c.id)}
            <button type="button" class="hrow" onclick={() => openConv(c.id)}><MaskedText text={c.title} /></button>
          {:else}
            <p class="muted">Nothing asked yet.</p>
          {/each}
        </div>
        <a class="link small" href="/advisor" onclick={() => advisor.hide()}>Open the full Advisor ›</a>
      {:else if view === 'start'}
        <div class="section-label">Checkup</div>
        <div class="checkup">
          {#if findings === null}
            <p class="muted">Looking things over…</p>
          {:else}
            {#if page.data.hasAccounts === false}
              <p class="muted">Nothing to check yet. <a class="link" href="/settings/connections" onclick={() => advisor.hide()}>Connect a bank</a> and the checkup reads it after the first sync.</p>
            {:else if !top}
              <div class="clear">
                <span class="ok" aria-hidden="true">✓</span>
                <div><div class="c-title">All clear</div><div class="c-sub">Nothing needs you right now.</div></div>
              </div>
            {:else}
              <div class="finding"><span aria-hidden="true">{top.emoji}</span> <Rich text={top.text} figures={top.figures} /></div>
            {/if}
            {#if good}
              <p class="good"><Rich text={good.text} figures={good.figures} /></p>
            {/if}
          {/if}
        </div>
        {#if suggestions.length}
          <div class="section-label">About this screen</div>
          <div class="sugs">
            {#each suggestions as s (s)}
              <button type="button" class="chip" onclick={() => ask(s)}><MaskedText text={s} /></button>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="ctx"><span class="dot"></span>Looking at {context}</div>
        {#each turns as t (t.id)}
          <div class="bubble"><MaskedText text={t.question} /></div>
          {#if t.status === 'done' && t.answer}
            <div class="ans"><Answer answer={t.answer} onask={(q) => ask(q)} /></div>
          {:else if t.status === 'error'}
            <p class="err">{t.error}</p>
          {:else}
            <div class="working">
              <span class="spin" aria-hidden="true"></span>
              <MaskedText text={t.steps?.length ? t.steps[t.steps.length - 1].label : 'Working it out…'} />
            </div>
          {/if}
        {/each}
        {#if last?.status === 'done'}
          <!-- The second sentence is the product's legal position, not a
               nicety: the Advisor is educational and never a registered
               investment adviser. Keep it on every answer. -->
          <p class="note">
            Every underlined figure opens the transactions behind it. Guidance for budgeting and planning, not financial
            or investment advice.
          </p>
        {/if}
      {/if}
      {#if error}<p class="err">{error}</p>{/if}
    </div>

    <footer class="foot">
      {#if view === 'start'}
        <div class="ctx"><span class="dot"></span>Looking at {context}</div>
      {:else if chips.length && !answering}
        <div class="chips">
          {#each chips as c (c)}<button type="button" class="chip" onclick={() => ask(c)}><MaskedText text={c} /></button>{/each}
        </div>
      {/if}
      <form
        class="ask"
        onsubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input
          bind:this={field}
          bind:value={input}
          placeholder={view === 'conv' ? 'Ask a follow-up…' : 'Ask about your money…'}
          aria-label="Ask the Advisor"
          disabled={answering}
        />
        <button type="submit" class="send" aria-label="Ask" disabled={answering || !input.trim()}>↑</button>
      </form>
    </footer>
  </div>
{/snippet}

{#if phone.current}
  <Sheet open={advisor.open} detent="large" onclose={() => advisor.hide()} label="Advisor">
    {@render body()}
  </Sheet>
{:else if advisor.open}
  <aside class="panel" aria-label="Advisor">{@render body()}</aside>
{/if}

<style>
  .panel {
    position: fixed;
    top: var(--topbar-h);
    right: 0;
    bottom: 0;
    z-index: 50;
    width: var(--advisor-w);
    max-width: 100vw;
    background: var(--panel);
    border-left: 1px solid var(--line);
    box-shadow: -12px 0 32px rgba(0, 0, 0, 0.06);
    animation: slide 200ms ease-out;
  }

  @keyframes slide {
    from {
      transform: translateX(24px);
      opacity: 0;
    }
  }

  .adv {
    display: flex;
    flex-direction: column;
    height: 100%;
    line-height: normal;
  }

  .panel .adv {
    padding: 20px 20px 16px;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .title {
    font-size: 18px;
    font-weight: 500;
  }

  .head-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .link {
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
  }

  .link:hover {
    background: none;
    text-decoration: underline;
  }

  .quiet {
    color: var(--ink-3);
    font-size: 14px;
  }

  .small {
    font-size: 14px;
  }

  .x {
    width: 28px;
    height: 28px;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--pill);
    color: var(--ink-2);
    cursor: pointer;
  }

  .scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .section-label {
    padding: 0;
  }

  .checkup {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    border-radius: var(--r-tile);
    background: var(--pill);
  }

  .clear {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .ok {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--ok);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    flex: 0 0 auto;
  }

  .c-title {
    font-size: 15px;
    font-weight: 500;
  }

  .c-sub,
  .muted {
    font-size: 13px;
    color: var(--ink-2);
    margin: 0;
  }

  .finding,
  .good {
    margin: 0;
    font-size: 15px;
    line-height: 1.5;
  }

  .sugs {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .chip {
    min-height: 0;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }

  .chip:hover {
    background: var(--pill);
  }

  .ctx {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: var(--r-pill);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 13px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .bubble {
    align-self: flex-end;
    max-width: 88%;
    padding: 12px 16px;
    border-radius: 20px 20px 6px 20px;
    background: var(--ink);
    color: var(--bg);
    font-size: 15px;
    line-height: 1.4;
  }

  .ans :global(.prose) {
    font-size: 16px;
    line-height: 1.6;
  }

  .ans :global(.figure),
  .finding :global(.figure),
  .good :global(.figure),
  .finding :global(a),
  .good :global(a) {
    color: var(--ink);
    font-weight: 500;
    text-decoration: underline dotted var(--accent);
    text-underline-offset: 4px;
  }

  .working {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--ink-2);
  }

  .spin {
    width: 14px;
    height: 14px;
    border: 2px solid var(--line);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .note {
    margin: 0;
    font-size: 13px;
    color: var(--ink-3);
  }

  .err {
    margin: 0;
    font-size: 14px;
    color: var(--over-text);
  }

  .hist {
    display: flex;
    flex-direction: column;
  }

  .hrow {
    min-height: 0;
    padding: 12px 0;
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
  }

  .hrow:hover {
    background: none;
    color: var(--accent-text);
  }

  .foot {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .ask {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 16px;
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .ask:focus-within {
    border-color: var(--accent);
  }

  .ask input {
    flex: 1 1 auto;
    min-height: 0;
    padding: 8px 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    font-size: 16px;
    box-shadow: none;
  }

  .ask input:focus {
    box-shadow: none;
  }

  .send {
    width: 36px;
    height: 36px;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 17px;
    font-weight: 600;
    flex: 0 0 auto;
  }

  .send:disabled {
    background: var(--track);
    color: var(--ink-3);
    opacity: 1;
  }
</style>
