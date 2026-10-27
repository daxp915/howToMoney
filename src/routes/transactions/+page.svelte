<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import DetailPanel from '$lib/components/ui/DetailPanel.svelte';
  import FilterChip from '$lib/components/ui/FilterChip.svelte';
  import Money from '$lib/components/ui/Money.svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import TransactionRow from '$lib/components/ui/TransactionRow.svelte';
  import Btn from '$lib/components/ui/Btn.svelte';
  import MaskedText from '$lib/components/MaskedText.svelte';
  import { phone } from '$lib/media.svelte';
  import { usd } from '$lib/money';
  import type { Detail } from '$lib/server/activity';
  import InOutBars from './InOutBars.svelte';
  import WhereItWent from './WhereItWent.svelte';
  import AddExpense from '$lib/components/AddExpense.svelte';
  import TxnDetail from './TxnDetail.svelte';

  let { data } = $props();

  // ---- URL helpers ----------------------------------------------------------
  function href(over: Record<string, string | null>): string {
    const p = new URLSearchParams(page.url.search);
    p.delete('select');
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === '') p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return s ? `?${s}` : '?';
  }

  const PERIODS = [
    { key: '1m', label: '1M' },
    { key: '6m', label: '6M' },
    { key: 'ytd', label: 'YTD' },
    { key: '1y', label: '1Y' },
    { key: 'all', label: 'All' }
  ];
  const periods = $derived(PERIODS.map((p) => ({ ...p, href: href({ p: p.key === '6m' ? null : p.key }) })));

  // ---- search -----------------------------------------------------------------
  // svelte-ignore state_referenced_locally
  let q = $state(data.filters.q);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function search() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      goto(href({ q: q.trim() || null, n: null }), { keepFocus: true, noScroll: true, replaceState: true });
    }, 300);
  }

  // ---- filter menus -----------------------------------------------------------
  let menu = $state<'category' | 'account' | 'more' | null>(null);
  let marking = $state(false);
  // A plain form post: the server marks, the page reloads its data.
  const markingAll = () => {
    marking = true;
    menu = null;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      marking = false;
    };
  };
  // Cash and anything else no bank feed sees (AddExpense refuses synced accounts).
  let addingCash = $state(false);
  const catName = $derived(
    data.filters.category === 'none'
      ? 'No category'
      : data.categories.find((c) => c.id === data.filters.category)?.name
  );
  const acctName = $derived(
    data.filters.account.length === 1 ? data.accounts.find((a) => a.id === data.filters.account[0])?.name : null
  );

  // Filters a drill-down sets that have no menu of their own (a figure's
  // merchant, money in or out, its date range, posted only). Each gets a chip
  // that says so and removes just itself: before, the list was filtered with
  // nothing on screen saying how, and only Clear brought the rest back.
  const fmtDay = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const rangeText = (from: string, to: string): string => {
    if (from && to) {
      const a = new Date(from + 'T12:00:00');
      const end = new Date(a.getFullYear(), a.getMonth() + 1, 0).toLocaleDateString('en-CA');
      if (from.endsWith('-01') && to === end)
        return a.toLocaleDateString('en-US', {
          month: 'long',
          ...(a.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {})
        });
      return from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
    }
    return from ? `Since ${fmtDay(from)}` : `Through ${fmtDay(to)}`;
  };
  const extraChips = $derived.by(() => {
    const f = data.filters;
    const out: { key: string; label: string; href: string }[] = [];
    if (f.merchant)
      out.push({ key: 'merchant', label: data.rows[0]?.merchant ?? f.merchant, href: href({ merchant: null, n: null }) });
    if (f.flow)
      out.push({ key: 'flow', label: f.flow === 'out' ? 'Money out' : f.flow === 'paid' ? 'Payments' : 'Money in', href: href({ flow: null, n: null }) });
    if (f.from || f.to)
      out.push({ key: 'dates', label: rangeText(f.from, f.to), href: href({ from: null, to: null, n: null }) });
    if (f.settled) out.push({ key: 'settled', label: 'Posted only', href: href({ settled: null, n: null }) });
    return out;
  });

  // ---- feed grouped by day, with month cards between months -------------------
  type Row = (typeof data.rows)[number];
  const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
  const days = $derived.by(() => {
    const out: { key: string; label: string; net: number; rows: Row[]; month: string }[] = [];
    for (const r of data.rows) {
      const k = dayKey(r.postedAt);
      let g = out[out.length - 1];
      if (!g || g.key !== k) {
        g = { key: k, label: dayLabel(k), net: 0, rows: [], month: k.slice(0, 7) };
        out.push(g);
      }
      g.rows.push(r);
      // A day's net leaves out transfers, hidden rows and split parents (their
      // parts count instead).
      if (!r.isTransfer && !r.excluded) g.net += r.amount;
    }
    return out;
  });

  function dayLabel(k: string): string {
    const d = new Date(k + 'T12:00:00');
    const today = new Date().toLocaleDateString('en-CA');
    const yest = new Date(Date.now() - 864e5).toLocaleDateString('en-CA');
    const base = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
    if (k === today) return `Today · ${base}`;
    if (k === yest) return `Yesterday · ${base}`;
    return base;
  }

  const summaryFor = (month: string) => data.summaries.find((s) => s.month === month);
  const topMax = (s: NonNullable<ReturnType<typeof summaryFor>>) => Math.max(1, ...s.top.map((t) => t.spent));

  // ---- selection: desktop panel, phone sheet ----------------------------------
  let selectedId = $state<string | null>(null);
  let detail = $state<Detail | null>(null);
  let detent = $state<'medium' | 'large'>('medium');
  let loadSeq = 0;

  async function load(id: string) {
    const seq = ++loadSeq;
    const r = await fetch(`/api/transactions/${id}`);
    if (seq !== loadSeq) return;
    detail = r.ok ? await r.json() : null;
  }

  function select(id: string, fromUrl = false) {
    selectedId = id;
    detent = 'medium';
    load(id);
    // Arriving with ?select= (Home's To review rows link that way), the URL
    // already says it -- and replaceState before the router has started
    // throws, which killed hydration and left the panel shut.
    if (fromUrl) return;
    const u = new URL(page.url);
    u.searchParams.set('select', id);
    replaceState(u, {});
  }

  function close() {
    selectedId = null;
    detail = null;
    const u = new URL(page.url);
    u.searchParams.delete('select');
    replaceState(u, {});
  }

  async function reload() {
    if (selectedId) await load(selectedId);
  }

  onMount(() => {
    const s = page.url.searchParams.get('select');
    if (s) select(s, true);
  });

  // ---- infinite scroll --------------------------------------------------------
  let sentinel = $state<HTMLElement | null>(null);
  let growing = false;
  $effect(() => {
    if (!sentinel || !data.more) return;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || growing) return;
      growing = true;
      await goto(href({ n: String(data.limit + 60) }), { noScroll: true, keepFocus: true, replaceState: true });
      growing = false;
    });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  const hero = $derived(data.hero);
</script>

<svelte:head><title>Activity · HTMFD</title></svelte:head>

<div class="activity">
  <div class="main-col">
    {#if hero}
      <Card pad="body" class="hero-card">
        <div class="hero">
          <div class="month">{hero.label}</div>
          <div class="big">
            <Money value={hero.spending} cents={false} href={hero.outHref} /> <span class="unit">out</span>
          </div>
          <div class="line">
            <Money value={hero.income} cents={false} href={hero.inHref} class="in" /> in · kept
            <Money value={hero.income - hero.spending} cents={false} href={hero.inHref} class="kept" />
          </div>
        </div>
        <InOutBars
          bars={data.bars}
          selected={hero.month}
          {periods}
          period={data.period}
          monthHref={(m) => href({ m: m === hero.month ? null : m })}
        />
      </Card>
      <WhereItWent
        rows={data.went.rows}
        total={data.went.total}
        month={data.went.month}
        note={data.went.note}
        outHref={data.went.outHref}
      />
    {/if}

    <div class="filters">
      <label class="search">
        <span class="glass" aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Search merchants, categories, amounts"
          aria-label="Search"
          bind:value={q}
          oninput={search}
        />
      </label>
      <div class="chips">
        <FilterChip
          active={data.filters.review}
          count={data.toReview}
          href={href({ review: data.filters.review ? null : '1', n: null })}>To review</FilterChip
        >
        <span class="menu-wrap">
          <FilterChip active={!!data.filters.category} onclick={() => (menu = menu === 'category' ? null : 'category')}
            >{catName ?? 'Category'} <span class="caret">▾</span></FilterChip
          >
          {#if menu === 'category'}
            <div class="menu" role="menu">
              {#if data.filters.category}<a role="menuitem" href={href({ category: null, n: null })} onclick={() => (menu = null)}>All categories</a>{/if}
              <a role="menuitem" href={href({ category: 'none', n: null })} onclick={() => (menu = null)}>No category</a>
              {#each [...data.categories].sort((a, b) => a.name.localeCompare(b.name)) as c (c.id)}
                <a role="menuitem" href={href({ category: c.id, n: null })} onclick={() => (menu = null)}
                  >{c.icon ?? ''} {c.name}</a
                >
              {/each}
            </div>
          {/if}
        </span>
        <span class="menu-wrap">
          <FilterChip active={data.filters.account.length > 0} onclick={() => (menu = menu === 'account' ? null : 'account')}
            >{acctName ?? 'Account'} <span class="caret">▾</span></FilterChip
          >
          {#if menu === 'account'}
            <div class="menu" role="menu">
              {#if data.filters.account.length}<a role="menuitem" href={href({ account: null, n: null })} onclick={() => (menu = null)}>All accounts</a>{/if}
              {#each data.accounts as a (a.id)}
                <a role="menuitem" href={href({ account: a.id, n: null })} onclick={() => (menu = null)}>{a.name}</a>
              {/each}
            </div>
          {/if}
        </span>
        {#each extraChips as c (c.key)}
          <FilterChip active href={c.href}
            >{c.label} <span class="x" aria-hidden="true">×</span><span class="sr">(remove this filter)</span></FilterChip
          >
        {/each}
        {#if data.filtered}
          <a class="clear" href="?">Clear</a>
        {/if}
        <button type="button" class="addcash" onclick={() => (addingCash = true)}>+ Cash</button>
        <span class="menu-wrap">
          <button
            type="button"
            class="more-btn"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menu === 'more'}
            onclick={() => (menu = menu === 'more' ? null : 'more')}>⋯</button
          >
          {#if menu === 'more'}
            <div class="menu right" role="menu">
              <form method="POST" action="?/reviewAll" use:enhance={markingAll}>
                <button type="submit" role="menuitem" disabled={!data.toReview}
                  >{data.toReview ? `Mark all ${data.toReview.toLocaleString()} reviewed` : 'Nothing to review'}</button
                >
              </form>
            </div>
          {/if}
        </span>
      </div>
    </div>

    {#if data.firstSync && !data.filtered}
      {@const n = data.firstSync.count.toLocaleString()}
      <!-- : once, after a new connection's first sync. Either answer
           clears it for good. -->
      <Card pad="body">
        <div class="first">
          <span class="first-t">{n} transaction{data.firstSync.count === 1 ? '' : 's'} from your first sync</span>
          <span class="first-p"
            >They're all waiting for review. Older ones are already filed, so the last two weeks are usually enough to check.</span
          >
          <div class="first-acts">
            <form method="POST" action="?/reviewRecent" use:enhance={markingAll}>
              <Btn variant="primary" full type="submit" disabled={marking}>Review just the last 2 weeks</Btn>
            </form>
            <form method="POST" action="?/reviewAll" use:enhance={markingAll}>
              <button type="submit" class="first-all" disabled={marking}>Mark all {n} reviewed</button>
            </form>
          </div>
        </div>
      </Card>
    {/if}

    {#if data.filtered}
      <!-- What a drill-down landed on: the count and total, which equal the
           figure that was clicked. -->
      <div class="drill">
        <span class="drill-count">{data.total.toLocaleString()} transaction{data.total === 1 ? '' : 's'}</span>
        <span class="drill-sum figure"><span class="amt">{usd(data.sum, { abs: data.filters.flow === 'out' })}</span></span>
      </div>
    {/if}

    {#each days as g, i (g.key)}
      {@const prev = days[i - 1]}
      {#if prev && prev.month !== g.month && summaryFor(g.month)}
        {@const s = summaryFor(g.month)!}
        <Card pad="body">
          <div class="review">
            <div class="review-head">
              <span class="review-title">{s.label} in review</span>
              <a class="text-link" href={s.outHref}>Details ›</a>
            </div>
            <div class="trio">
              <div><span class="k">In</span><Money value={s.income} cents={false} href={s.inHref} class="in" /></div>
              <div><span class="k">Out</span><Money value={s.spending} cents={false} href={s.outHref} /></div>
              <div><span class="k">Kept</span><Money value={s.kept} cents={false} href={s.inHref} /></div>
            </div>
            <div class="tops">
              {#each s.top as t (t.name)}
                <div class="top">
                  <span class="tname">{t.icon ?? ''} {t.name}</span>
                  <span class="tbar"><span style="width: {(t.spent / topMax(s)) * 100}%"></span></span>
                  <Money value={t.spent} cents={false} href={t.href} class="tfig" />
                </div>
              {/each}
            </div>
          </div>
        </Card>
      {/if}
      <section class="day">
        <div class="day-head">
          <h2 class="section-label">{g.label}</h2>
          <span class="net"
            ><span class="amt">{g.net < 0 ? '−' : g.net > 0 ? '+' : ''}{usd(g.net, { abs: true })}</span></span
          >
        </div>
        <Card>
          {#each g.rows as t (t.id)}
            <TransactionRow
              {t}
              selected={selectedId === t.id}
              onclick={() => select(t.splitPart && t.parentId ? t.parentId : t.id)}
              onpick={() => select(t.id)}
            />
          {/each}
        </Card>
      </section>
    {:else}
      {#if data.noHistory}
      <Card pad="body">
        <div class="nomatch">
          <div class="nm-title">No transactions yet</div>
          <div class="nm-sub">
            Your bank's history arrives with the first sync, usually within a minute of connecting. Cash you
            spend can go in now with + Cash.
          </div>
        </div>
      </Card>
      {:else}
      <Card pad="body">
        <div class="nomatch">
          <div class="nm-title">
            {#if data.filters.q}Nothing matches "<MaskedText text={data.filters.q} />"{:else}Nothing here{/if}
          </div>
          <div class="nm-sub">Try a longer period, or ask the Advisor to look wider.</div>
          <div class="nm-acts">
            <Btn variant="secondary" size="sm" href={href({ from: null, to: null, m: null, p: 'all' })}>Search all time</Btn>
            <Btn
              variant="soft"
              size="sm"
              href="/advisor?view=ask&q={encodeURIComponent(data.filters.q ? `Find "${data.filters.q}" in my transactions` : '')}"
              >Ask the Advisor</Btn
            >
          </div>
        </div>
      </Card>
      {/if}
    {/each}

    {#if data.more}<div class="sentinel" bind:this={sentinel}>Loading more…</div>{/if}
  </div>

  {#if !phone.current}
    <div class="rail">
      {#if detail}
        <DetailPanel label="Transaction" onclose={close}>
          <TxnDetail d={detail} categories={data.categories} mode="panel" onclose={close} {reload} />
        </DetailPanel>
      {/if}
    </div>
  {/if}
</div>

{#if phone.current}
  <Sheet open={!!detail} bind:detent onclose={close} label="Transaction">
    {#if detail}
      <TxnDetail
        d={detail}
        categories={data.categories}
        mode="sheet"
        compact={detent === 'medium'}
        onclose={close}
        onexpand={() => (detent = 'large')}
        {reload}
      />
    {/if}
  </Sheet>
{/if}

{#if addingCash}<AddExpense onclose={() => (addingCash = false)} />{/if}

<svelte:window
  onclick={(e) => {
    if (menu && !(e.target as HTMLElement).closest('.menu-wrap')) menu = null;
  }}
/>

<style>
  .activity {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 32px;
    align-items: start;
    line-height: normal;
  }

  .main-col {
    display: flex;
    flex-direction: column;
    gap: 28px;
    min-width: 0;
  }

  .rail {
    min-width: 0;
    align-self: stretch;
  }

  :global(.hero-card) {
    padding: 22px 24px 18px !important;
  }

  .hero {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .month {
    font-size: 14px;
    color: var(--ink-2);
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

  .line {
    font-size: 15px;
    color: var(--ink-2);
  }

  .line :global(.in),
  .trio :global(.in) {
    color: var(--money-in-text);
  }

  .line :global(.kept) {
    color: var(--ink-2);
  }

  .filters {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }

  .search {
    flex: 1 1 260px;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0 16px;
    border-radius: var(--r-field);
    background: var(--surface);
    box-shadow: var(--shadow);
  }

  .glass {
    color: var(--ink-3);
    font-size: 18px;
  }

  .search input {
    min-height: 0;
    padding: 12px 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    font-size: 16px;
    box-shadow: none;
  }

  .search input:focus {
    box-shadow: none;
  }

  .search:focus-within {
    box-shadow:
      var(--shadow),
      0 0 0 2px var(--accent);
  }

  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .caret {
    font-size: 11px;
    color: var(--ink-3);
  }

  .menu-wrap {
    position: relative;
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 220px;
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
    border-radius: var(--r-tile);
    background: var(--surface);
    box-shadow: var(--shadow), 0 12px 32px rgba(0, 0, 0, 0.12);
  }

  .menu a {
    padding: 9px 12px;
    border-radius: 8px;
    font-size: 15px;
    color: var(--ink);
    white-space: nowrap;
  }

  .menu a:hover {
    background: var(--pill);
  }

  .menu.right {
    left: auto;
    right: 0;
  }

  .menu button {
    width: 100%;
    min-height: 0;
    margin: 0;
    padding: 9px 12px;
    border: 0;
    border-radius: 8px;
    background: none;
    font: inherit;
    font-size: 15px;
    color: var(--ink);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .menu button:hover:not(:disabled) {
    background: var(--pill);
  }

  .menu button:disabled {
    color: var(--ink-3);
    cursor: default;
  }

  .more-btn {
    min-height: 0;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--ink-2);
    font: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .more-btn:hover,
  .more-btn[aria-expanded='true'] {
    background: var(--pill);
  }

  .first {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .first-t {
    font-size: 17px;
    font-weight: 500;
  }

  .first-p {
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink-2);
  }

  .first-acts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 10px;
  }

  .first-all {
    width: 100%;
    min-height: 0;
    margin: 0;
    padding: 13px;
    border: 0;
    border-radius: var(--r-pill);
    background: none;
    font: inherit;
    font-size: 16px;
    font-weight: 500;
    color: var(--ink);
    cursor: pointer;
  }

  .first-all:hover:not(:disabled) {
    background: var(--pill);
  }

  .x {
    margin-left: -2px;
    font-size: 16px;
    line-height: 1;
    opacity: 0.7;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .clear {
    font-size: 14px;
    font-weight: 500;
    color: var(--accent-text);
    padding: 0 6px;
  }

  .addcash {
    min-height: 0;
    padding: 8px 10px;
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }

  .addcash:hover {
    background: none;
    text-decoration: underline;
  }

  .drill {
    display: flex;
    justify-content: space-between;
    padding: 0 4px;
    margin-bottom: -16px;
    font-size: 14px;
    color: var(--ink-2);
  }

  .day {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .day-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0 4px;
  }

  .day-head .section-label {
    margin: 0;
    padding: 0;
  }

  .net {
    font-size: 13px;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }

  .review {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .review-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .review-title {
    font-size: 17px;
    font-weight: 500;
  }

  .text-link {
    font-size: 14px;
    font-weight: 500;
    color: var(--accent-text);
  }

  .trio {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .trio > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 22px;
  }

  .k {
    font-size: 13px;
    color: var(--ink-3);
  }

  .tops {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .top {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr) 64px;
    gap: 12px;
    align-items: center;
    font-size: 14px;
    color: var(--ink-2);
  }

  .tname {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tbar {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: var(--track);
    overflow: hidden;
  }

  .tbar span {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 3px;
    background: var(--money-out);
  }

  .top :global(.tfig) {
    text-align: right;
    color: var(--ink-2);
  }

  .nomatch {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .nm-title {
    font-size: 17px;
    font-weight: 500;
  }

  .nm-sub {
    font-size: 14px;
    color: var(--ink-2);
  }

  .nm-acts {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  .sentinel {
    padding: 12px;
    text-align: center;
    font-size: 13px;
    color: var(--ink-3);
  }

  @media (max-width: 1100px) {
    .activity {
      grid-template-columns: minmax(0, 1fr) 340px;
    }
  }

  @media (max-width: 760px) {
    .activity {
      grid-template-columns: minmax(0, 1fr);
    }

    .main-col {
      gap: 24px;
    }

    .big {
      font-size: 36px;
    }

    .top {
      grid-template-columns: 110px minmax(0, 1fr) 56px;
    }
  }
</style>
