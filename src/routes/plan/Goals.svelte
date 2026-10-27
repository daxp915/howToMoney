<script lang="ts">
  import { act } from '$lib/client/act';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { onMount } from 'svelte';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import DetailPanel from '$lib/components/ui/DetailPanel.svelte';
  import Money from '$lib/components/ui/Money.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import Tag from '$lib/components/ui/Tag.svelte';
  import Tip from '$lib/components/ui/Tip.svelte';
  import { phone } from '$lib/media.svelte';
  import { usd } from '$lib/money';
  import { toast } from '$lib/toast.svelte';
  import type { loadGoals } from './goals.server';
  import type { ActionData } from './$types';
  import GoalForm from './GoalForm.svelte';

  let { data }: { data: Awaited<ReturnType<typeof loadGoals>>; form: ActionData } = $props();

  type G = (typeof data.active)[number];
  let selectedId = $state<string | null>(null);
  let mode = $state<'detail' | 'new' | 'edit' | null>(null);
  let newKind = $state<'save' | 'payoff'>('save');
  let newAccount = $state('');
  let newInitial = $state<{ name?: string; target?: string; date?: string }>({});
  const loanToPay = $derived(data.accounts.find((a) => a.type === 'loan' && a.balance < -1) ?? null);
  const savings = $derived(data.accounts.find((a) => a.type === 'depository' && /saving/i.test(a.label)) ?? null);
  function startNew(kind: 'save' | 'payoff', account = '', initial: typeof newInitial = {}) {
    newKind = kind;
    newAccount = account;
    newInitial = initial;
    selectedId = null;
    mode = 'new';
  }
  const selected = $derived(
    data.active.find((g) => g.id === selectedId) ?? data.reached.find((g) => g.id === selectedId) ?? null
  );

  function open(g: G) {
    selectedId = g.id;
    mode = 'detail';
  }
  function close() {
    selectedId = null;
    mode = null;
  }

  // An Advisor answer's "Set up goal" lands here with the form's values in
  // the URL. Opened once, then taken out of the URL so a reload or Back does
  // not open it again. Toward the savings account by default, as the
  // "Save for something" choice does.
  onMount(() => {
    const q = page.url.searchParams;
    if (q.get('new') !== 'save') return;
    const target = (q.get('target') ?? '').replace(/[^\d.]/g, '');
    const date = q.get('date') ?? '';
    startNew('save', savings?.id ?? '', {
      name: (q.get('name') ?? '').slice(0, 60) || undefined,
      target: target || undefined,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
    });
    replaceState('/plan?tab=goals', {});
  });

  // Desktop opens the first goal so the panel is never empty.
  $effect(() => {
    if (!phone.current && mode === null && data.active.length) {
      selectedId = data.active[0].id;
      mode = 'detail';
    }
  });

  const byDate = (d: Date | string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null;
  const longDate = (d: Date | string | null) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null;
  const fill = (g: G) => Math.round(g.progress * 100);
  const behindTone = (g: G) => (g.behind > 0.5 ? 'watch' : 'ok');

  function meta(g: G): string {
    const parts = [g.account ?? 'Entered by hand'];
    if (g.direction === 'payoff') parts.push('paying down');
    if (g.targetDate) parts.push(`by ${byDate(g.targetDate)}`);
    return parts.join(' · ');
  }

  async function markReached(g: G) {
    try {
      await act('status', { id: g.id, status: 'achieved' }, { path: '/plan?tab=goals' });
      toast.show(`${g.name} marked reached`, () =>
        act('status', { id: g.id, status: 'active' }, { path: '/plan?tab=goals' }).then(() => {})
      );
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    }
  }

  // ---- the detail chart ------------------------------------------------------
  function chart(g: G) {
    const W = 360;
    const H = 120;
    const t0 = new Date(g.createdAt).getTime();
    const t1 = g.targetDate ? new Date(g.targetDate).getTime() : Date.now() + 365 * 864e5;
    const lo = Math.min(g.starting, g.target, g.current, ...g.history.map((h) => h.value));
    const hi = Math.max(g.starting, g.target, g.current, ...g.history.map((h) => h.value));
    const x = (t: number) => ((t - t0) / Math.max(t1 - t0, 1)) * W;
    const y = (v: number) => H - 8 - ((v - lo) / Math.max(hi - lo, 1)) * (H - 16);
    const pts = [
      ...g.history.map((h) => [x(new Date(h.day + 'T12:00:00').getTime()), y(h.value)]),
      [x(Date.now()), y(g.current)]
    ];
    if (!g.history.length) pts.unshift([0, y(g.starting)]);
    return {
      W,
      H,
      line: pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' '),
      pace: `0,${y(g.starting).toFixed(1)} ${W},${y(g.target).toFixed(1)}`,
      end: { left: (x(Date.now()) / W) * 100, top: (y(g.current) / H) * 100 }
    };
  }
</script>

{#snippet detail(g: G)}
  {@const c = chart(g)}
  <div class="gd">
    <div class="gd-top">
      <span class="gd-acct">{g.account ?? 'Entered by hand'}</span>
      <button type="button" class="x" aria-label="Close" onclick={close}>×</button>
    </div>
    <div class="gd-name"><span aria-hidden="true">{g.emoji}</span> {g.name}</div>
    <div class="gd-big"><Money value={g.current} abs={g.direction === 'payoff'} /></div>
    <div class="gd-sub">
      {g.direction === 'payoff' ? 'owed, down to' : 'of'}
      <Money value={g.target} cents={false} abs />{#if g.targetDate}{' '}by {longDate(g.targetDate)}{/if}
    </div>
    <div class="gd-chart">
      <svg viewBox="0 0 {c.W} {c.H}" preserveAspectRatio="none" aria-hidden="true">
        <polyline class="pace" points={c.pace} />
        <polyline class="bal {behindTone(g)}" points={c.line} />
      </svg>
      <span class="gd-dot {behindTone(g)}" style="left: calc({c.end.left}% - 4px); top: calc({c.end.top}% - 4px)"></span>
      {#if g.behind > 0.5}
        <span class="gd-tag" style="left: min(calc({c.end.left}% + 8px), calc(100% - 110px)); top: calc({c.end.top}% - 30px)"
          ><Tag tone="watch" size="sm"><Money value={g.behind} cents={false} /> behind</Tag></span
        >
      {/if}
    </div>
    <div class="gd-axis">
      <span>{byDate(g.createdAt)}</span><span>{g.targetDate ? byDate(g.targetDate) : ''}</span>
    </div>
    <div class="gd-kv">
      {#if g.needed}<div><span>Needed each month</span><Money value={g.needed} /></div>{/if}
      {#if g.moved3 !== null}<div><span>Moved in, last 3 months</span><Money value={g.moved3} href={g.movedHref} /></div>{/if}
      {#if g.daysLeft !== null}<div><span>Months left</span><b>{Math.max(0, Math.round(g.daysLeft / 30.44))}</b></div>{/if}
    </div>
    {#if g.status === 'active' && !g.achieved}
      <div class="gd-acts">
        {#if g.needed}
          <Btn
            variant="primary"
            full
            href="/advisor?view=ask&q={encodeURIComponent(`How can I find ${usd(g.needed, { cents: false })} a month for ${g.name}?`)}"
            >Find {usd(g.needed, { cents: false })} for {g.name}</Btn
          >
        {/if}
        <div class="two">
          <Btn variant="secondary" onclick={() => (mode = 'edit')}>Edit goal</Btn>
          <Btn variant="secondary" onclick={() => markReached(g)}>Mark reached</Btn>
        </div>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet panelBody()}
  {#if mode === 'new'}
    {#key newKind + newAccount}
      <GoalForm accounts={data.accounts} onclose={close} initialKind={newKind} initialAccount={newAccount} initial={newInitial} />
    {/key}
  {:else if mode === 'edit' && selected}
    <GoalForm accounts={data.accounts} goal={selected} onclose={() => (mode = 'detail')} />
  {:else if selected}
    {@render detail(selected)}
  {/if}
{/snippet}

<div class="goals">
  <div class="main">
    {#if data.active.length}
      <Card pad="body" class="g-hero">
        <div class="big">
          <Money value={data.hero.needed} cents={false} /> <span class="unit">a month</span>
        </div>
        <div class="sub">keeps all {data.hero.count} goal{data.hero.count === 1 ? '' : 's'} on schedule</div>
        <div class="cmp">
          <span class="k">Needed</span>
          <span class="bar"><span class="ink" style="width: 100%"></span></span>
          <Money value={data.hero.needed} cents={false} />
          <span class="k">Moved, 3-mo avg</span>
          <span class="bar"
            ><span
              class={data.hero.short > 0.5 ? 'watch' : 'ok'}
              style="width: {Math.min(100, (data.hero.movedAvg / Math.max(data.hero.needed, 1)) * 100)}%"
            ></span></span
          >
          <Money value={data.hero.movedAvg} cents={false} />
        </div>
        {#if data.hero.short > 0.5}
          <div class="short">
            <Tag tone="watch"><Money value={data.hero.short} cents={false} /> a month behind</Tag>
            {#if data.hero.mostly}<span class="mostly">mostly {data.hero.mostly}</span>{/if}
          </div>
        {:else}
          <div class="short"><Tag tone="ok">On schedule</Tag></div>
        {/if}
      </Card>

      <Section label="Active" note="{data.active.length} goal{data.active.length === 1 ? '' : 's'}">
        <Card>
          {#each data.active as g (g.id)}
            <button type="button" class="grow" class:sel={selectedId === g.id && mode !== null} onclick={() => open(g)}>
              <span class="l1">
                <span class="emoji" aria-hidden="true">{g.emoji}</span>
                <span class="who"><span class="nm">{g.name}</span><span class="meta">{meta(g)}</span></span>
                {#if g.behind > 0.5}<Tag tone="watch" size="sm"><Money value={g.behind} cents={false} /> behind</Tag>{/if}
              </span>
              <span class="l2">
                <span class="saved"><Money value={g.current} abs={g.direction === 'payoff'} /></span>
                <span class="gbar">
                  <span class="gfill {behindTone(g)}" style="width: {fill(g)}%"></span>
                  {#if g.tick !== null}<span class="tick" style="left: {g.tick * 100}%"></span>{/if}
                </span>
                <span class="target"><Money value={g.target} cents={false} abs /></span>
                {#if g.needed}<span class="needed"><Money value={g.needed} cents={false} /><span class="per">/mo needed</span></span>{/if}
              </span>
            </button>
          {/each}
        </Card>
        {#if data.active.some((g) => g.tick !== null)}
          <div class="tipspot">
            <Tip id="goal-tick" title="The tick is where you'd need to be today" floating style="left: 36%; top: -10px">
              If the bar has passed the tick, you'll hit the goal by its date. If it falls short, the goal turns
              yellow.
            </Tip>
          </div>
        {/if}
      </Section>
    {:else}
      <Section label="Goals">
        <Card pad="body">
          <div class="empty-title">What are you working toward?</div>
          <div class="choices">
            <button type="button" class="choice" onclick={() => startNew('save', savings?.id ?? '')}>
              <span class="arrowc">↑</span>
              <span class="who"
                ><span class="nm">Grow a balance</span><span class="meta"
                  >e.g. emergency fund{savings ? ` in ${savings.label}` : ''}</span
                ></span
              >
              <span class="chev">›</span>
            </button>
            {#if loanToPay}
              <button type="button" class="choice" onclick={() => startNew('payoff', loanToPay.id)}>
                <span class="arrowc">↓</span>
                <span class="who"
                  ><span class="nm">Pay off {loanToPay.label}</span><span class="meta"
                    ><Money value={-loanToPay.balance} cents={false} /> left · suggested from your accounts</span
                  ></span
                >
                <span class="chev">›</span>
              </button>
            {/if}
          </div>
        </Card>
      </Section>
    {/if}

    {#if data.reached.length}
      <Section label="Reached">
        <Card>
          {#each data.reached as g (g.id)}
            <div class="reached">
              <span class="emoji" aria-hidden="true">{g.emoji}</span>
              <span class="who"><span class="nm">{g.name}</span><span class="meta">Reached {byDate(g.updatedAt)}</span></span>
              <span class="amt-ok"><Money value={g.target} cents={false} abs /><span class="chk">✓</span></span>
            </div>
          {/each}
        </Card>
      </Section>
    {/if}

    <button type="button" class="newgoal" onclick={() => startNew('save')}>
      <span class="plus" aria-hidden="true">+</span>
      <span class="who"><span class="nm">New goal</span><span class="meta">Grow a balance, or pay one down to zero</span></span>
    </button>
  </div>

  {#if !phone.current}
    <div class="rail">
      {#if mode}
        <DetailPanel label={mode === 'new' ? 'New goal' : 'Goal'} onclose={close}>
          {@render panelBody()}
        </DetailPanel>
      {/if}
    </div>
  {/if}
</div>

{#if phone.current}
  <Sheet open={mode !== null} detent="large" onclose={close} label="Goal">
    {@render panelBody()}
  </Sheet>
{/if}

<style>
  .goals {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--rail-w);
    gap: 32px;
    align-items: start;
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: 28px;
    min-width: 0;
  }

  .rail {
    min-width: 0;
    align-self: stretch;
  }

  :global(.g-hero) {
    padding: 22px 24px !important;
  }

  .big {
    font-size: 48px;
    font-weight: 500;
    letter-spacing: var(--ls-hero);
    line-height: 1.1;
  }

  .unit {
    font-weight: 400;
    color: var(--ink-2);
  }

  .sub {
    margin-top: 4px;
    font-size: 15px;
    color: var(--ink-2);
  }

  .cmp {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr) 80px;
    gap: 10px 16px;
    align-items: center;
    margin-top: 20px;
    font-size: 15px;
  }

  .cmp :global(.figure) {
    text-align: right;
  }

  .k {
    font-size: 14px;
    color: var(--ink-2);
  }

  .bar {
    position: relative;
    height: 8px;
    border-radius: 4px;
    background: var(--track);
    overflow: hidden;
  }

  .bar span {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 4px;
  }

  .ink {
    background: var(--ink);
  }

  .ok,
  .gfill.ok {
    background: var(--ok);
  }

  .watch,
  .gfill.watch {
    background: var(--watch);
  }

  .short {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
  }

  .mostly {
    font-size: 13px;
    color: var(--ink-2);
  }

  .grow {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 12px;
    width: 100%;
    min-height: 0;
    margin: 0;
    padding: 16px 20px;
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .grow:first-child {
    border-top: 0;
  }

  .grow:hover {
    background: var(--pill);
  }

  .grow:active {
    transform: none;
  }

  .grow.sel {
    background: var(--selected-row);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .l1 {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .emoji {
    font-size: 18px;
    width: 26px;
    text-align: center;
    flex: 0 0 auto;
  }

  .who {
    flex: 1 1 0%;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .nm {
    font-size: 16px;
  }

  .meta {
    font-size: 13px;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .l2 {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) 80px 130px;
    gap: 16px;
    align-items: center;
  }

  .saved {
    font-size: 16px;
  }

  .gbar {
    position: relative;
    height: 8px;
    border-radius: 4px;
    background: var(--track);
  }

  .gfill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 4px;
  }

  /* Where you would need to be today: 2px of ink, 4px past the bar each way. */
  .tick {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--ink);
  }

  .target {
    font-size: 15px;
    color: var(--ink-3);
    text-align: right;
  }

  .target :global(.figure) {
    font-weight: 400;
  }

  .needed {
    font-size: 15px;
    text-align: right;
  }

  .per {
    color: var(--ink-2);
    font-weight: 400;
  }

  .tipspot {
    position: relative;
    height: 0;
    margin-top: -130px;
    margin-bottom: 130px;
  }

  .reached {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-top: 1px solid var(--line);
  }

  .reached:first-child {
    border-top: 0;
  }

  .amt-ok {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
  }

  .chk {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--ok);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
  }

  .newgoal {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 0;
    padding: 18px 20px;
    border: 1.5px dashed var(--line);
    border-radius: var(--r-card);
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .newgoal:hover {
    background: var(--surface);
  }

  .newgoal:active {
    transform: none;
  }

  .plus {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
  }

  .empty-title {
    font-size: 17px;
    font-weight: 500;
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 14px;
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 0;
    padding: 14px 16px;
    border: 0;
    border-radius: var(--r-tile);
    background: var(--pill);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .choice:hover {
    background: color-mix(in srgb, var(--pill) 85%, var(--ink) 6%);
  }

  .arrowc {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
  }

  .chev {
    color: var(--ink-3);
  }

  /* ---- detail ---- */
  .gd {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .gd-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }

  .gd-acct {
    font-size: 13px;
    color: var(--ink-3);
  }

  .x {
    min-height: 0;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--ink-3);
    font-size: 18px;
    cursor: pointer;
  }

  .gd-name {
    font-size: 20px;
    font-weight: 500;
  }

  .gd-big {
    font-size: 40px;
    letter-spacing: var(--ls-hero);
    line-height: 1.1;
  }

  .gd-sub {
    font-size: 15px;
    color: var(--ink-2);
  }

  .gd-sub :global(.figure) {
    color: var(--ink-2);
    font-weight: 400;
  }

  .gd-chart {
    position: relative;
    height: 150px;
    margin-top: 24px;
  }

  .gd-chart svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .gd-chart polyline {
    fill: none;
    vector-effect: non-scaling-stroke;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .pace {
    stroke: var(--ink-3);
    stroke-width: 1.5;
    stroke-dasharray: 4 5;
  }

  .bal {
    stroke-width: 2.5;
    stroke: var(--ok);
  }

  .bal.watch {
    stroke: var(--watch);
  }

  .gd-dot {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .gd-tag {
    position: absolute;
  }

  .gd-axis {
    display: flex;
    justify-content: space-between;
    margin: 8px 0 12px;
    font-size: 13px;
    color: var(--ink-3);
  }

  .gd-kv div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 0;
    border-top: 1px solid var(--line);
    font-size: 15px;
  }

  .gd-kv span {
    color: var(--ink-2);
  }

  .gd-kv b {
    font-weight: 500;
  }

  .gd-acts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
  }

  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  @media (max-width: 1100px) {
    .goals {
      grid-template-columns: minmax(0, 1fr) 340px;
    }
  }

  @media (max-width: 760px) {
    .goals {
      grid-template-columns: minmax(0, 1fr);
    }

    .main {
      gap: 24px;
    }

    .big {
      font-size: 36px;
    }

    .cmp {
      grid-template-columns: 110px minmax(0, 1fr) 64px;
    }

    .l2 {
      grid-template-columns: 84px minmax(0, 1fr) 64px;
    }

    .needed {
      display: none;
    }

    .meta {
      white-space: normal;
    }
  }
</style>
