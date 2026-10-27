<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onDestroy, tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MaskedText from '$lib/components/MaskedText.svelte';
  import Rich from '$lib/components/advisor/Rich.svelte';
  import Answer from '$lib/components/advisor/Answer.svelte';
  import type { Finding, Severity } from '$lib/advisor/checkup';

  /**
   * The Advisor, per handoff 7a-7s. Checkup on top (worked out by the app, no
   * model), Ask below, past questions beside. A conversation replaces Ask in
   * place and folds the checkup to one line. The phone splits the page into
   * Checkup / Ask / Past screens (7l, 7m, 7o), picked by `?view=`.
   */
  let { data } = $props();

  type Conversation = NonNullable<typeof data.conversation>;
  type Turn = Conversation['turns'][number];

  // ---- the conversation, polled while an answer is worked out -------------------
  let conv = $state<Conversation | null>(null);
  $effect(() => {
    conv = data.conversation;
  });

  let poll: ReturnType<typeof setInterval> | null = null;
  async function refresh() {
    if (!conv) return;
    const r = await fetch(`/api/advisor/${conv.id}`);
    if (r.ok) conv = await r.json();
  }
  $effect(() => {
    const busy = !!conv?.answering;
    if (busy && !poll) poll = setInterval(refresh, 1200);
    if (!busy && poll) {
      clearInterval(poll);
      poll = null;
    }
  });
  onDestroy(() => poll && clearInterval(poll));

  // Reopening a past question re-runs it on today's figures (7a).
  const todayKey = new Date().toDateString();
  let rerunFor = '';
  $effect(() => {
    const c = conv;
    if (!c || c.answering || rerunFor === c.id) return;
    const last = c.turns.at(-1);
    if (!last || last.status !== 'done') return;
    const ran = new Date(last.reopenedAt ?? last.finishedAt ?? last.createdAt).toDateString();
    if (ran === todayKey) return;
    rerunFor = c.id;
    rerun(last.id);
  });

  async function rerun(turnId: string) {
    if (!conv) return;
    const r = await fetch(`/api/advisor/${conv.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rerun: turnId })
    });
    if (r.ok) await refresh();
  }

  // ---- asking ---------------------------------------------------------------------
  let draft = $state('');
  let followUp = $state('');
  let sending = $state(false);
  let askError = $state<string | null>(null);
  $effect(() => {
    if (data.prefill) draft = data.prefill;
  });

  async function ask(question: string, conversationId: string | null = null) {
    const q = question.trim();
    if (!q || sending) return;
    sending = true;
    askError = null;
    try {
      const r = await fetch('/api/advisor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, conversationId })
      });
      if (!r.ok) {
        askError = (await r.json().catch(() => null))?.message ?? 'That did not go through. Try again.';
        // Busy means an answer this page has not seen yet: show it.
        if (r.status === 409) await refresh();
        return;
      }
      const ids = (await r.json()) as { conversationId: string };
      draft = '';
      followUp = '';
      rerunFor = ids.conversationId;
      // A follow-up navigates to the URL already open, and SvelteKit skips a
      // load whose URL did not change -- the new turn would never appear.
      await goto(`/advisor?c=${ids.conversationId}`, { noScroll: !!conversationId, invalidateAll: true });
    } finally {
      sending = false;
    }
  }

  function enterToAsk(e: KeyboardEvent, text: string, conversationId: string | null = null) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask(text, conversationId);
    }
  }

  async function stop() {
    const r = await fetch('/api/advisor/stop', { method: 'POST' });
    const back = r.ok ? ((await r.json()) as { question: string | null; conversationId: string | null }) : null;
    if (back?.conversationId) {
      followUp = back.question ?? '';
      await refresh();
    } else {
      await goto(`/advisor?view=ask&q=${encodeURIComponent(back?.question ?? '')}`);
    }
  }

  // ---- the checkup ----------------------------------------------------------------
  const SEVERITY: Record<Severity, string> = { action: 'Needs action', look: 'Worth a look', good: 'Good news' };
  const MAX_SHOWN = 5;

  /** Dismissed this visit and still inside their 6-second Undo window. */
  let undoing = $state<Record<string, Finding>>({});
  /** Dismissed this visit, past the window. */
  let gone = $state<string[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const shown = $derived(data.checkup.findings.filter((f) => !gone.includes(f.key)).slice(0, MAX_SHOWN));
  const live = $derived(shown.filter((f) => !undoing[f.key]));
  const hiddenCount = $derived(data.checkup.hidden.length + gone.length);
  const counts = $derived({
    action: live.filter((f) => f.severity === 'action').length,
    look: live.filter((f) => f.severity === 'look').length,
    good: live.filter((f) => f.severity === 'good').length
  });
  const allClear = $derived(counts.action + counts.look === 0);

  async function dismiss(f: Finding) {
    undoing = { ...undoing, [f.key]: f };
    timers.set(
      f.key,
      setTimeout(() => {
        const { [f.key]: _, ...rest } = undoing;
        undoing = rest;
        gone = [...gone, f.key];
        timers.delete(f.key);
      }, 6000)
    );
    await fetch('/api/advisor/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: f.key })
    });
  }

  async function undo(key: string) {
    clearTimeout(timers.get(key));
    timers.delete(key);
    const { [key]: _, ...rest } = undoing;
    undoing = rest;
    await fetch('/api/advisor/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restore: [key] })
    });
  }

  async function showHidden() {
    const keys = [...data.checkup.hidden.map((f) => f.key), ...gone];
    await fetch('/api/advisor/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restore: keys })
    });
    gone = [];
    await invalidateAll();
  }

  let checkupOpen = $state(false);

  // ---- past questions ---------------------------------------------------------------
  /** Deleted, waiting out the Undo toast before the DELETE is sent. */
  let deleting = $state<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  /**
   * Sent deletes. The list comes from the page load, which still holds the row
   * until the next invalidate -- forgetting the id when the toast closed is
   * what brought deleted questions back.
   */
  let removed = $state<string[]>([]);
  const past = $derived(data.conversations.filter((c) => c.id !== deleting?.id && !removed.includes(c.id)));

  function flushDelete() {
    if (!deleting) return;
    clearTimeout(deleting.timer);
    const id = deleting.id;
    removed = [...removed, id];
    deleting = null;
    fetch(`/api/advisor/${id}`, { method: 'DELETE', keepalive: true })
      .then((r) => {
        if (!r.ok && r.status !== 404) throw new Error(String(r.status));
      })
      .catch(() => (removed = removed.filter((x) => x !== id)));
  }
  async function remove(id: string) {
    flushDelete();
    deleting = { id, timer: setTimeout(flushDelete, 6000) };
    swiped = null;
    if (conv?.id === id) await goto('/advisor');
  }
  function undoDelete() {
    if (!deleting) return;
    clearTimeout(deleting.timer);
    deleting = null;
  }
  onDestroy(flushDelete);

  // Phone 7o: swipe a row left to show Delete (long-press does the same).
  let swiped = $state<string | null>(null);
  let startX = 0;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  function rowDown(e: PointerEvent, id: string) {
    startX = e.clientX;
    pressTimer = setTimeout(() => (swiped = id), 550);
  }
  function rowMove(e: PointerEvent, id: string) {
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 8 && pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    if (dx < -40) swiped = id;
    if (dx > 40 && swiped === id) swiped = null;
  }
  function rowUp() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }

  // ---- words ------------------------------------------------------------------------
  const syncLine = $derived.by(() => {
    const s = data.lastSync;
    if (!s) return 'never synced';
    const when = new Date(s.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (s.status === 'failed') return `last sync failed ${when}`;
    if (s.status === 'completed_with_errors') return `synced ${when}, some accounts didn’t answer`;
    const n = data.accountCount;
    return `synced ${when}, ${n === 1 ? 'the one account' : `all ${n} accounts`} answered`;
  });
  const syncedShort = $derived(
    data.lastSync
      ? `Synced ${new Date(data.lastSync.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : 'Not synced yet'
  );

  const dayLabel = (d: Date | string) => {
    const date = new Date(d);
    return date.toDateString() === todayKey ? 'Today' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  function asked(t: Turn): string {
    const at = new Date(t.createdAt);
    const date = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (t.reopenedAt) return `${date}, reopened`;
    if (Date.now() - at.getTime() < 90_000) return 'just now';
    if (at.toDateString() === todayKey) {
      return `today, ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
    return date;
  }

  /** What the thinking card lists: the lookups, then writing it up. */
  function thinking(t: Turn) {
    const steps = [...(t.steps ?? [])];
    const running = steps.some((s) => !s.done);
    if (!steps.length) return [{ label: 'Reading the question', state: 'running' }, { label: 'Writing it up', state: 'queued' }];
    return [
      ...steps.map((s) => ({ label: s.done ? s.label : `${s.label}…`, state: s.done ? 'done' : 'running' })),
      { label: running ? 'Writing it up' : 'Writing it up…', state: running ? 'queued' : 'running' }
    ];
  }

  // ---- the phone's screens -------------------------------------------------------------
  const phone = $derived(
    conv ? 'conv' : data.view === 'past' ? 'past' : data.view === 'ask' || data.prefill ? 'ask' : 'checkup'
  );
  let quick = $state('');
  async function openAsk(text: string) {
    await goto(`/advisor?view=ask${text.trim() ? `&q=${encodeURIComponent(text.trim())}` : ''}`);
    await tick();
    (document.querySelector('.ask-box textarea') as HTMLTextAreaElement | null)?.focus();
  }

  const lastTurn = $derived(conv?.turns.at(-1) ?? null);
  const followups = $derived(lastTurn?.status === 'done' ? (lastTurn.answer?.followups ?? []) : []);
</script>

<svelte:head><title>Advisor · howToMoney</title></svelte:head>
<svelte:window onpagehide={flushDelete} />

{#snippet findingRow(f: Finding)}
  {#if undoing[f.key]}
    <div class="undo-line">
      <span>Hidden: <b><MaskedText text={f.short} /></b>. <MaskedText text={f.returns} /></span>
      <button type="button" class="undo" onclick={() => undo(f.key)}>Undo</button>
    </div>
  {:else}
    <div class="finding">
      <span class="f-emoji {f.severity}" aria-hidden="true">{f.emoji}</span>
      <div class="f-body">
        <div class="f-head"><Rich text={f.text} figures={f.figures} /></div>
        <div class="f-sub">
          <span class="tag {f.severity}">{SEVERITY[f.severity]}</span>
          {#if f.context}<span class="f-context desk-inline"><Rich text={f.context} figures={f.figures} /></span>{/if}
          {#if f.link}<a class="f-link phone-inline" href={f.link.href}>{f.link.label}</a>{/if}
        </div>
      </div>
      {#if f.link}<a class="f-link desk" href={f.link.href}>{f.link.label}</a>{:else}<span class="desk"></span>{/if}
      <button type="button" class="x" aria-label="Hide this until its figure changes" onclick={() => dismiss(f)}>
        <Icon name="close" size={15} stroke={2.75} />
      </button>
    </div>
  {/if}
{/snippet}

{#snippet checkupCard()}
  <section class="card checkup">
    <div class="c-head">
      <h2 class="c-title">Checkup</h2>
      <span class="c-note desk-inline">
        {data.hasAccounts === false
          ? ''
          : allClear && data.lastSync
            ? `Checked after the ${new Date(data.lastSync.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} sync`
            : allClear
              ? ''
              : `${live.length} thing${live.length === 1 ? '' : 's'}, most urgent first`}
      </span>
    </div>
    {#if data.hasAccounts === false}
      <!-- "All clear" would be a claim about accounts it has never seen. -->
      <div class="clear none">
        <div>
          <div class="clear-title">Nothing to check yet</div>
          <div class="clear-sub">
            The checkup reads your accounts after each sync. <a href="/settings/connections">Connect a bank</a> and it starts with the first one.
          </div>
        </div>
      </div>
    {:else if allClear}
      <div class="clear">
        <span class="clear-check"><Icon name="check" size={22} stroke={2.75} /></span>
        <div>
          <div class="clear-title">All clear</div>
          <div class="clear-sub">Nothing needs you right now. The app looks again after each sync.</div>
        </div>
      </div>
    {/if}
    {#each shown as f (f.key)}
      {@render findingRow(f)}
    {/each}
    {#if !allClear || hiddenCount > 0}
    <div class="c-foot" class:split={hiddenCount > 0} class:end={allClear && hiddenCount > 0}>
      {#if !allClear}
        <span class="desk-inline">
          Worked out by the app from your transactions after each sync; no AI involved. × hides one until its figure changes.
        </span>
        <span class="phone-inline">Worked out by the app after each sync; no AI involved.</span>
      {/if}
      {#if hiddenCount > 0}
        <button type="button" class="show" onclick={showHidden}>{hiddenCount} hidden · Show</button>
      {/if}
    </div>
    {/if}
  </section>
{/snippet}

{#snippet askBox()}
  <section class="ask">
    <div class="desk">
      <h2 class="a-title">Ask</h2>
      <p class="a-lede">The app works out the figures; the answer explains them.</p>
    </div>
    <p class="a-lede-phone phone">The app works out the figures; the answer explains them.</p>
    <form class="ask-box" onsubmit={(e) => (e.preventDefault(), ask(draft))}>
      <textarea
        bind:value={draft}
        placeholder="Ask about your money…"
        aria-label="Ask about your money"
        rows="2"
        onkeydown={(e) => enterToAsk(e, draft)}
      ></textarea>
      <div class="ask-foot desk-flex">
        <span class="hint"
          >{#if data.questionsLeft !== null && data.questionsLeft <= 5}{data.questionsLeft} question{data.questionsLeft === 1
              ? ''
              : 's'} left this month · {/if}Enter to ask · Shift + Enter for a new line</span
        >
        <button class="ask-btn" type="submit" disabled={!draft.trim() || sending}>Ask</button>
      </div>
    </form>
    <button class="ask-btn wide phone" type="button" disabled={!draft.trim() || sending} onclick={() => ask(draft)}>Ask</button>
    {#if askError}<p class="ask-error">{askError}</p>{/if}
    <div class="eyebrow try phone">Try one</div>
    <div class="chips">
      {#each data.suggestions as s (s)}
        <button class="chip" type="button" onclick={() => ask(s)}><MaskedText text={s} /></button>
      {/each}
    </div>
  </section>
{/snippet}

{#snippet pastList()}
  <aside class="card past">
    <h2 class="p-title">Past questions</h2>
    {#each past as c (c.id)}
      {@const open = conv?.id === c.id}
      <div class="p-row" class:open>
        <a class="p-link" href="/advisor?c={c.id}">
          <span class="p-q"><MaskedText text={c.title} /></span>
          <span class="p-date">{dayLabel(c.createdAt)}{open ? ' · open' : ''}</span>
        </a>
        <button type="button" class="bin" aria-label="Delete this question" onclick={() => remove(c.id)}>
          <Icon name="trash" size={14} stroke={2.75} />
        </button>
      </div>
    {:else}
      <p class="p-empty">Questions you ask are kept here.</p>
    {/each}
    {#if past.length}<p class="p-foot">Click one to reopen it. The bin deletes it, with Undo.</p>{/if}
  </aside>
{/snippet}

<div class="hf-page adv" data-phone={phone}>
  <!-- desktop header -->
  <header class="hf-head desk-flex">
    <div>
      <h1 class="hf-title">Advisor</h1>
      <p class="hf-lede">Your accounts, read closely · {syncLine}</p>
    </div>
    {#if conv}
      <a class="new-q" href="/advisor"><Icon name="plus" size={15} stroke={2.75} />New question</a>
    {/if}
  </header>

  <!-- phone headers -->
  {#if phone === 'conv'}
    <div class="ph-bar phone-flex">
      <a class="back" href="/advisor"><Icon name="back" size={18} stroke={2.75} />Advisor</a>
      <a class="new-sm" href="/advisor?view=ask"><Icon name="plus" size={14} stroke={2.75} />New</a>
    </div>
  {:else if phone === 'past'}
    <div class="ph-bar phone-flex">
      <a class="back" href="/advisor"><Icon name="back" size={18} stroke={2.75} />Advisor</a>
    </div>
    <div class="phone">
      <h1 class="hf-title">Past questions</h1>
      <p class="ph-sub">{past.length} conversation{past.length === 1 ? '' : 's'}</p>
    </div>
  {:else}
    <div class="ph-head phone-flex">
      <div>
        <h1 class="hf-title">Advisor</h1>
        <p class="ph-sub">{syncedShort}</p>
      </div>
      <a class="hist" href="/advisor?view=past" aria-label="Past questions"><Icon name="history" size={19} stroke={2.75} /></a>
    </div>
    <div class="seg phone-flex" role="tablist">
      <a role="tab" aria-selected={phone === 'checkup'} class:on={phone === 'checkup'} href="/advisor">Checkup</a>
      <a role="tab" aria-selected={phone === 'ask'} class:on={phone === 'ask'} href="/advisor?view=ask">Ask</a>
    </div>
  {/if}

  <div class="body">
    <div class="col">
      {#if conv}
        <!-- 7b: folded while a conversation is open -->
        <div class="desk">
          {#if checkupOpen}
            {@render checkupCard()}
          {:else}
            <div class="folded">
              <span class="fold-title">Checkup</span>
              {#if counts.action}<span class="tag action">{counts.action} need{counts.action === 1 ? 's' : ''} action</span>{/if}
              {#if counts.look}<span class="tag look">{counts.look} worth a look</span>{/if}
              {#if counts.good}<span class="tag good">{counts.good} good news</span>{/if}
              <button type="button" class="fold-show" onclick={() => (checkupOpen = true)}>
                Show <Icon name="chevron-down" size={13} stroke={2.75} />
              </button>
            </div>
          {/if}
        </div>

        {#each conv.turns as t (t.id)}
          <section class="turn">
            <div>
              <div class="eyebrow">You asked · {asked(t)}</div>
              <h2 class="q"><MaskedText text={t.question} /></h2>
            </div>
            {#if t.status === 'pending'}
              <div class="card think">
                <div class="th-title">Working it out</div>
                {#each thinking(t) as s, i (i)}
                  <div class="th-row {s.state}">
                    <span class="th-dot">
                      {#if s.state === 'done'}<Icon name="check" size={13} stroke={3} />{/if}
                    </span>
                    <span class="th-label"><MaskedText text={s.label} /></span>
                  </div>
                {/each}
                <div class="th-foot">
                  <span>Usually a few seconds</span>
                  <button type="button" class="outline-sm" onclick={stop}>Stop</button>
                </div>
              </div>
            {:else if t.status === 'error'}
              <div class="card err">
                <span class="err-icon"><Icon name="alert" size={18} stroke={2.75} /></span>
                <div class="err-body">
                  <div>
                    <div class="err-title">The answer didn't come through</div>
                    <div class="err-text">{t.error ?? 'Something went wrong. Your question is kept.'}</div>
                  </div>
                  <div class="err-actions">
                    <button type="button" class="retry" onclick={() => rerun(t.id)}>
                      <Icon name="refresh" size={15} stroke={2.75} />Try again
                    </button>
                    <a class="outline-md" href="/advisor?view=ask&q={encodeURIComponent(t.question)}">Edit question</a>
                  </div>
                </div>
              </div>
            {:else if t.answer}
              <Answer answer={t.answer} onask={(q) => ask(q, conv!.id)} />
            {/if}
          </section>
        {/each}

        {#if lastTurn && lastTurn.status !== 'pending'}
          <div class="follow">
            <form class="fu-box" onsubmit={(e) => (e.preventDefault(), ask(followUp, conv!.id))}>
              <textarea
                bind:value={followUp}
                placeholder="Ask a follow-up…"
                aria-label="Ask a follow-up"
                rows="1"
                onkeydown={(e) => enterToAsk(e, followUp, conv!.id)}
              ></textarea>
              <button class="send" type="submit" aria-label="Ask" disabled={!followUp.trim() || sending}>
                <Icon name="arrow-up" size={17} stroke={2.75} />
              </button>
            </form>
            {#if followups.length}
              <div class="chips fu-chips">
                {#each followups as s (s)}
                  <button class="chip sm" type="button" onclick={() => ask(s, conv!.id)}><MaskedText text={s} /></button>
                {/each}
              </div>
            {/if}
            {#if askError}<p class="ask-error">{askError}</p>{/if}
          </div>
        {/if}
      {:else}
        <div class:ph-hide={phone !== 'checkup'}>{@render checkupCard()}</div>
        <form class="quick phone-flex" class:ph-hide={phone !== 'checkup'} onsubmit={(e) => (e.preventDefault(), openAsk(quick))}>
          <input bind:value={quick} placeholder="Ask about your money…" aria-label="Ask about your money" />
          <button class="send" type="submit" aria-label="Ask" disabled={!quick.trim()}>
            <Icon name="arrow-up" size={17} stroke={2.75} />
          </button>
        </form>
        <div class:ph-hide={phone !== 'ask'}>{@render askBox()}</div>

        {#if phone === 'past'}
          <div class="card past-ph phone">
            {#each past as c (c.id)}
              <div class="pp-row" class:swiped={swiped === c.id}>
                <button type="button" class="pp-del" onclick={() => remove(c.id)}>
                  <Icon name="trash" size={18} stroke={2.75} />Delete
                </button>
                <a
                  class="pp-link"
                  href="/advisor?c={c.id}"
                  onpointerdown={(e) => rowDown(e, c.id)}
                  onpointermove={(e) => rowMove(e, c.id)}
                  onpointerup={rowUp}
                  onpointercancel={rowUp}
                  onclick={(e) => swiped === c.id && e.preventDefault()}
                >
                  <span class="pp-text">
                    <span class="pp-q"><MaskedText text={c.title} /></span>
                    <span class="p-date">{dayLabel(c.createdAt)}</span>
                  </span>
                  <span class="pp-chev">›</span>
                </a>
              </div>
            {:else}
              <p class="p-empty">Questions you ask are kept here.</p>
            {/each}
          </div>
          {#if past.length}
            <p class="pp-foot phone">Reopening one re-runs it on today's figures. Long-press also offers Delete.</p>
          {/if}
        {/if}
      {/if}
    </div>

    <div class="desk">{@render pastList()}</div>
  </div>
</div>

{#if deleting}
  <div class="toast" role="status">
    Question deleted <button type="button" onclick={undoDelete}>Undo</button>
  </div>
{/if}

<style>
  .adv {
    line-height: normal;
    font-variant-numeric: tabular-nums;
  }
  .phone,
  .phone-flex,
  .phone-inline {
    display: none !important;
  }
  .desk-flex {
    display: flex;
  }
  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 28px;
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 22px;
    align-items: start;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-width: 0;
  }
  .col > div:empty {
    display: none;
  }
  .new-q {
    height: 42px;
    padding: 0 18px;
    border-radius: 999px;
    border: 1.5px solid var(--color-input-border);
    background: var(--color-surface);
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 14.5px;
    font-weight: 600;
    box-sizing: border-box;
    color: var(--color-text);
    text-decoration: none;
  }

  /* ---- checkup (7a, 7k) ---- */
  .checkup {
    padding: 22px 26px 20px;
  }
  .c-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    padding-bottom: 8px;
  }
  .c-title {
    margin: 0;
    font: 400 22px var(--font-heading);
  }
  .c-note {
    font-size: 13px;
    color: var(--color-muted);
  }
  .finding {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto 30px;
    gap: 14px;
    align-items: center;
    padding: 13px 0;
    border-top: 1px solid var(--color-rule);
  }
  .f-emoji {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
  }
  .f-emoji.action {
    background: var(--color-accent-100);
  }
  .f-emoji.look {
    background: var(--color-inset);
  }
  .f-emoji.good {
    background: var(--color-sage-100);
  }
  .f-body {
    min-width: 0;
  }
  .f-head {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
  }
  .f-sub {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 5px;
    flex-wrap: wrap;
  }
  .tag {
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
  }
  .tag.action {
    background: var(--color-accent-100);
    color: var(--color-accent-800);
  }
  .tag.look {
    background: var(--color-inset);
    color: var(--color-chip-neutral-fg);
  }
  .tag.good {
    background: var(--color-sage-100);
    color: var(--color-sage-700);
  }
  .f-context {
    font-size: 13px;
    color: var(--color-muted);
  }
  .f-context :global(.fig) {
    color: var(--color-text);
  }
  .f-link {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-accent-700);
    white-space: nowrap;
    text-decoration: none;
  }
  .f-link:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .x {
    all: unset;
    cursor: pointer;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-muted);
  }
  .x:hover {
    background: var(--color-inset);
  }
  .undo-line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin: 6px 0;
    padding: 11px 16px;
    border-radius: 999px;
    background: var(--color-inset);
    font-size: 13.5px;
    color: var(--color-text-2);
  }
  .undo-line b {
    color: var(--color-text);
  }
  .undo,
  .show {
    all: unset;
    cursor: pointer;
    color: var(--color-accent-700);
  }
  .undo {
    font-weight: 700;
  }
  .show {
    font-weight: 600;
  }
  .c-foot {
    font-size: 12.5px;
    color: var(--color-muted);
    padding-top: 10px;
    border-top: 1px solid var(--color-rule);
  }
  .c-foot.split {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }
  .c-foot.end {
    justify-content: flex-end;
  }
  .clear {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr);
    gap: 16px;
    align-items: center;
    padding: 4px 0 14px;
  }
  /* No check mark beside it, so no icon column. */
  .clear.none {
    grid-template-columns: minmax(0, 1fr);
  }
  .clear-check {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--color-sage-100);
    color: var(--color-sage-700);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .clear-title {
    font: 400 20px var(--font-heading);
  }
  .clear-sub {
    font-size: 14px;
    color: var(--color-text-2);
    margin-top: 3px;
  }

  .clear-sub a {
    color: var(--accent-text);
    font-weight: 500;
    text-decoration: none;
  }

  /* folded (7b) */
  .folded {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 12px 14px 12px 22px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .fold-title {
    font: 400 17px var(--font-heading);
    margin-right: 4px;
  }
  .folded .tag {
    padding: 3px 10px;
  }
  .fold-show {
    all: unset;
    cursor: pointer;
    margin-left: auto;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-accent-700);
    padding-right: 8px;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  /* ---- ask (7a, 7m) ---- */
  .ask {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .a-title {
    margin: 0;
    font: 400 22px var(--font-heading);
  }
  .a-lede {
    margin: 4px 0 0;
    font-size: 13.5px;
    color: var(--color-muted);
  }
  .ask-box {
    background: var(--color-input-bg);
    border: 1.5px solid var(--color-input-border);
    border-radius: 24px;
    padding: 16px 18px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ask-box:focus-within,
  .fu-box:focus-within,
  .quick:focus-within {
    border-color: var(--color-accent);
  }
  .ask-box textarea,
  .fu-box textarea {
    all: unset;
    display: block;
    width: 100%;
    min-height: 64px;
    font-size: 16px;
    line-height: 1.5;
    color: var(--color-text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    field-sizing: content;
  }
  .ask-box textarea::placeholder,
  .fu-box textarea::placeholder,
  .quick input::placeholder {
    color: var(--color-placeholder);
  }
  .ask-foot {
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .hint {
    font-size: 12.5px;
    color: var(--color-muted);
  }
  .ask-btn {
    all: unset;
    cursor: pointer;
    height: 40px;
    padding: 0 20px;
    border-radius: 999px;
    background: var(--color-accent);
    color: var(--color-on-primary);
    display: flex;
    align-items: center;
    font: 400 15px var(--font-heading);
  }
  .ask-btn:disabled,
  .send:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .ask-error {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-accent-700);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    all: unset;
    cursor: pointer;
    padding: 9px 16px;
    border-radius: 999px;
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-2);
  }
  .chip.sm {
    padding: 8px 14px;
    font-size: 13.5px;
  }
  .chip:hover {
    background: var(--color-accent-100);
  }
  .eyebrow {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  /* ---- conversation (7b, 7d, 7j) ---- */
  .turn {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .q {
    margin: 8px 0 0;
    font: 400 30px / 1.15 var(--font-heading);
  }
  .think {
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .th-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-text-2);
    padding-bottom: 8px;
  }
  .th-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 0;
    font-size: 14.5px;
  }
  .th-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .done .th-dot {
    background: var(--color-sage-100);
    color: var(--color-sage-700);
  }
  .done .th-label {
    color: var(--color-text-2);
  }
  .running .th-dot {
    border: 3px solid var(--color-track);
    border-top-color: var(--color-accent);
    animation: spin 0.9s linear infinite;
  }
  .running .th-label {
    font-weight: 600;
  }
  .queued .th-dot {
    border: 1.5px solid var(--color-input-border);
  }
  .queued .th-label {
    color: var(--color-muted);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .running .th-dot {
      animation-duration: 3s;
    }
  }
  .th-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 12px;
    margin-top: 6px;
    border-top: 1px solid var(--color-rule);
    font-size: 12.5px;
    color: var(--color-muted);
  }
  .outline-sm,
  .outline-md {
    all: unset;
    cursor: pointer;
    border-radius: 999px;
    border: 1.5px solid var(--color-input-border);
    display: flex;
    align-items: center;
    font-weight: 600;
    color: var(--color-text);
    box-sizing: border-box;
  }
  .outline-sm {
    height: 36px;
    padding: 0 16px;
    font-size: 13.5px;
  }
  .outline-md {
    height: 42px;
    padding: 0 18px;
    font-size: 14.5px;
  }
  .err {
    padding: 22px 28px;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }
  .err-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--color-accent-100);
    color: var(--color-accent-700);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .err-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .err-title {
    font-size: 16px;
    font-weight: 700;
  }
  .err-text {
    font-size: 14px;
    line-height: 1.55;
    color: var(--color-text-2);
    margin-top: 4px;
  }
  .err-actions {
    display: flex;
    gap: 10px;
  }
  .retry {
    all: unset;
    cursor: pointer;
    height: 42px;
    padding: 0 20px;
    border-radius: 999px;
    background: var(--color-accent);
    color: var(--color-on-primary);
    display: flex;
    align-items: center;
    gap: 8px;
    font: 400 15px var(--font-heading);
  }
  .follow {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .fu-box {
    background: var(--color-input-bg);
    border: 1.5px solid var(--color-input-border);
    border-radius: 20px;
    padding: 13px 10px 10px 18px;
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .fu-box textarea {
    min-height: 0;
    padding-bottom: 6px;
  }
  .send {
    all: unset;
    cursor: pointer;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--color-accent);
    color: var(--color-on-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  /* ---- past questions (7a) ---- */
  .past {
    padding: 20px 20px 14px;
    display: flex;
    flex-direction: column;
  }
  .p-title {
    margin: 0;
    font: 400 19px var(--font-heading);
    padding: 0 4px 8px;
  }
  .p-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 30px;
    gap: 8px;
    align-items: center;
    padding: 10px 4px;
    border-top: 1px solid var(--color-rule);
  }
  .p-row.open,
  .p-row:hover {
    background: var(--color-inset);
    border-radius: 16px;
  }
  .p-row.open {
    padding: 10px 12px;
    border-top-color: transparent;
  }
  .p-row.open + .p-row {
    margin-top: 4px;
  }
  .p-link {
    display: flex;
    flex-direction: column;
    color: inherit;
    text-decoration: none;
    min-width: 0;
  }
  .p-q {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
  }
  .open .p-q {
    font-weight: 700;
  }
  .p-date {
    font-size: 12.5px;
    color: var(--color-muted);
    margin-top: 2px;
  }
  .bin {
    all: unset;
    cursor: pointer;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--color-surface);
    color: var(--color-accent-700);
    display: flex;
    align-items: center;
    justify-content: center;
    visibility: hidden;
  }
  .p-row:hover .bin,
  .bin:focus-visible {
    visibility: visible;
  }
  .p-foot {
    margin: 0;
    font-size: 12px;
    color: var(--color-muted);
    padding: 10px 4px 0;
    border-top: 1px solid var(--color-rule);
  }
  .p-empty {
    margin: 0;
    font-size: 13px;
    color: var(--color-muted);
    padding: 6px 4px;
  }

  .toast {
    position: fixed;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    z-index: 70;
    background: var(--color-dark);
    color: var(--color-on-accent);
    border-radius: 999px;
    padding: 12px 18px 12px 20px;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .toast button {
    all: unset;
    cursor: pointer;
    font-weight: 700;
    color: var(--color-accent);
  }

  button:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* ---- phone (7l, 7m, 7n, 7o) ---- */
  @media (max-width: 760px) {
    :global(.main:has(> .hf-page.adv)) {
      padding-top: 24px;
      padding-inline: 18px;
    }
    :global(.main:has(> .hf-page.adv[data-phone='conv'])),
    :global(.main:has(> .hf-page.adv[data-phone='past'])) {
      padding-top: 18px;
    }
    .adv {
      gap: 14px;
    }
    .desk,
    .desk-flex,
    .desk-inline,
    .ph-hide {
      display: none !important;
    }
    .phone {
      display: block !important;
    }
    .phone-flex {
      display: flex !important;
    }
    .phone-inline {
      display: inline !important;
    }
    .body {
      grid-template-columns: minmax(0, 1fr);
    }
    .col {
      gap: 14px;
    }
    .ph-head {
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    .ph-sub {
      margin: 4px 0 0;
      font-size: 13.5px;
      color: var(--color-muted);
    }
    .hist {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--color-surface);
      border: 1px solid var(--color-border-strong);
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      box-sizing: border-box;
      color: var(--color-text);
    }
    .seg {
      gap: 4px;
      padding: 4px;
      border-radius: 999px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
    }
    .seg a {
      flex: 1 1 0%;
      text-align: center;
      padding: 10px 0;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-2);
      text-decoration: none;
    }
    .seg a.on {
      font-weight: 700;
      background: var(--color-dark);
      color: var(--color-on-accent);
    }
    .ph-bar {
      justify-content: space-between;
      align-items: center;
    }
    .back {
      height: 44px;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 15px;
      font-weight: 600;
      color: var(--color-accent-700);
      text-decoration: none;
    }
    .new-sm {
      height: 40px;
      padding: 0 16px;
      border-radius: 999px;
      border: 1.5px solid var(--color-input-border);
      background: var(--color-surface);
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      box-sizing: border-box;
      color: var(--color-text);
      text-decoration: none;
    }

    .checkup {
      padding: 8px 20px 14px;
    }
    .c-head {
      display: none;
    }
    .finding {
      grid-template-columns: 36px minmax(0, 1fr) 30px;
      gap: 12px;
      align-items: start;
      padding: 12px 0;
    }
    .checkup .finding:first-of-type,
    .clear + .finding {
      border-top: 0;
    }
    .f-emoji {
      width: 36px;
      height: 36px;
      font-size: 15px;
    }
    .f-sub {
      margin-top: 6px;
    }
    .quick {
      height: 52px;
      border-radius: 999px;
      border: 1.5px solid var(--color-input-border);
      background: var(--color-input-bg);
      align-items: center;
      padding: 0 6px 0 20px;
      box-sizing: border-box;
      gap: 10px;
    }
    .quick input {
      all: unset;
      flex: 1 1 0%;
      min-width: 0;
      font-size: 16px;
      color: var(--color-text);
    }

    .a-lede-phone {
      margin: 0;
      font-size: 14px;
      color: var(--color-text-2);
      line-height: 1.5;
      padding: 4px 2px 0;
    }
    .ask-box {
      padding: 16px 18px;
      min-height: 120px;
      box-sizing: border-box;
    }
    .ask-box textarea {
      min-height: 84px;
    }
    .ask-btn.wide {
      height: 52px;
      justify-content: center;
      font-size: 17px;
      display: flex !important;
    }
    .eyebrow.try {
      padding-top: 6px;
    }
    .chip {
      min-height: 44px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      padding: 10px 16px;
      line-height: 1.35;
      border-radius: 22px;
    }

    .q {
      margin-top: 6px;
      font-size: 26px;
    }
    .think,
    .err {
      padding: 20px;
    }
    .follow {
      position: sticky;
      bottom: calc(76px + env(safe-area-inset-bottom));
      z-index: 5;
    }
    .fu-box {
      padding: 6px 6px 6px 18px;
      align-items: center;
      min-height: 56px;
      box-sizing: border-box;
    }
    .fu-box textarea {
      padding-bottom: 0;
    }
    .fu-box .send {
      width: 44px;
      height: 44px;
    }
    .fu-chips {
      display: none;
    }

    /* 7o */
    .past-ph {
      padding: 6px 0;
      overflow: hidden;
    }
    .pp-row {
      position: relative;
      overflow: hidden;
    }
    .pp-row + .pp-row {
      border-top: 1px solid var(--color-rule);
    }
    .pp-del {
      all: unset;
      cursor: pointer;
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 96px;
      background: var(--color-accent);
      color: var(--color-on-primary);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      font-size: 13px;
      font-weight: 700;
    }
    .pp-link {
      position: relative;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      min-height: 56px;
      box-sizing: border-box;
      background: var(--color-surface);
      color: inherit;
      text-decoration: none;
      transition: transform 0.18s ease;
      touch-action: pan-y;
    }
    .swiped .pp-link {
      transform: translateX(-96px);
    }
    .pp-text {
      flex: 1 1 0%;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .pp-q {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.35;
    }
    .pp-chev {
      color: var(--color-faint);
      font-weight: 700;
    }
    .pp-foot {
      margin: 0;
      font-size: 12.5px;
      color: var(--color-muted);
      padding: 0 4px;
      line-height: 1.5;
    }
    .toast {
      bottom: calc(88px + env(safe-area-inset-bottom));
    }
  }
</style>
