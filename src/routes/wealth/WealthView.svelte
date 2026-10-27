<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Card from '$lib/components/ui/Card.svelte';
  import DetailPanel from '$lib/components/ui/DetailPanel.svelte';
  import Money from '$lib/components/ui/Money.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import { phone } from '$lib/media.svelte';
  import { usd } from '$lib/money';
  import type { loadWealth } from './wealth.server';
  import InvestmentDetail from './InvestmentDetail.svelte';
  import LoanDetail from './LoanDetail.svelte';
  import AccountDetail from './AccountDetail.svelte';
  import NetWorthChart from './NetWorthChart.svelte';

  /**
   * Wealth: net worth and its trend, then every account by group.
   * Desktop is master/detail -- the selected account fills the right column.
   * On a phone an account is a pushed screen (/wealth/<id>) with "‹ Wealth".
   */
  let { data }: { data: Awaited<ReturnType<typeof loadWealth>> } = $props();

  const qs = (p: string | null) => {
    const u = new URLSearchParams(page.url.search);
    if (p) u.set('p', p);
    else u.delete('p');
    const s = u.toString();
    return s ? `?${s}` : '';
  };
  const periods = $derived(
    [
      { key: '1m', label: '1M' },
      { key: '3m', label: '3M' },
      { key: 'ytd', label: 'YTD' },
      { key: '1y', label: '1Y' },
      { key: 'all', label: 'All' }
    ].map((p) => ({ ...p, href: page.url.pathname + qs(p.key === 'ytd' ? null : p.key) }))
  );
  const accountHref = (id: string) => `/wealth/${id}${qs(data.period === 'ytd' ? null : data.period)}`;
  const since = $derived(
    new Date(data.series.from + 'T12:00:00').toLocaleDateString(
      'en-US',
      data.period === '1m' ? { month: 'short', day: 'numeric' } : { month: 'long' }
    )
  );

  // Paid-off loans fold into one row: "3 student loans · All paid off".
  function shown(g: (typeof data.groups)[number]) {
    if (g.key !== 'loans') return { rows: g.rows, folded: null };
    const done = g.rows.filter((r) => r.paidOff);
    if (done.length < 2) return { rows: g.rows, folded: null };
    const student = done.every((r) => /student/i.test(r.name));
    return {
      rows: g.rows.filter((r) => !r.paidOff),
      folded: { id: done[0].id, title: `${done.length} ${student ? 'student loans' : 'loans'}` }
    };
  }

  const showList = $derived(!(phone.current && data.pushed));
  const showDetail = $derived(!phone.current || data.pushed);
  const close = () => goto('/wealth' + qs(data.period === 'ytd' ? null : data.period), { noScroll: true });
</script>

<div class="wealth" class:pushed={data.pushed}>
  <!-- The hero follows an opened account (/wealth/<id>): its balance and its
       own line, with "All accounts" back to the whole picture. -->
  {#snippet hero()}
    <Card pad="body" class="nw-card">
      <div class="head">
        <div class="cap">{data.focus ? data.focus.name : 'Net worth'}</div>
        {#if data.focus && !phone.current}
          <a class="all" href={'/wealth' + qs(data.period === 'ytd' ? null : data.period)} data-sveltekit-noscroll
            >All accounts</a
          >
        {/if}
      </div>
      <div class="big"><Money value={data.focus ? data.focus.balance : data.worth} cents={false} /></div>
      {#if data.series.points.length > 1}
        <div class="change">
          {data.series.change >= 0 ? '↑' : '↓'}
          <Money value={Math.abs(data.series.change)} cents={false} /> since {since}
        </div>
        {#key data.focus?.id}
          <NetWorthChart
            points={data.series.points}
            {periods}
            period={data.period}
            label={data.focus ? `${data.focus.name} balance by day` : 'Net worth by day'}
          />
        {/key}
      {/if}
    </Card>
  {/snippet}

  {#if showList}
    <div class="main">
      {@render hero()}

      {#each data.groups as g (g.key)}
        {@const s = shown(g)}
        <Section label={g.label}>
          {#snippet aside()}<span class="gtotal"><span class="amt">{usd(g.total, { cents: false })}</span></span>{/snippet}
          <Card>
            {#each s.rows as r (r.id)}
              <a
                class="arow"
                class:sel={!phone.current && data.selectedId === r.id}
                href={accountHref(r.id)}
                data-sveltekit-noscroll
              >
                <span class="who"><span class="nm">{r.name}</span><span class="meta">{r.meta}</span></span>
                <span class="bal figure"><span class="amt">{usd(r.balance)}</span></span>
                <span class="chev" aria-hidden="true">›</span>
              </a>
            {/each}
            {#if s.folded}
              <a class="arow" href={accountHref(s.folded.id)} data-sveltekit-noscroll>
                <span class="who"><span class="nm">{s.folded.title}</span><span class="meta">All paid off</span></span>
                <span class="bal figure paid"><span class="ok">✓</span><span class="amt">$0.00</span></span>
                <span class="chev" aria-hidden="true">›</span>
              </a>
            {/if}
          </Card>
        </Section>
      {:else}
        <Card pad="body"><p class="none">No accounts yet. <a href="/settings/connections">Connect a bank</a>.</p></Card>
      {/each}

      {#if data.groups.reduce((n, g) => n + g.rows.length, 0) < 3}
        <!-- : only a checking account linked -- the rest of the picture
             is a dashed slot each, one tap from Connections. -->
        <div class="slots">
          {#each [{ k: 'cash', l: 'Savings' }, { k: 'investments', l: 'Investments' }, { k: 'loans', l: 'Loans' }].filter((x) => x.k === 'cash' ? (data.groups.find((g) => g.key === 'cash')?.rows.length ?? 0) < 2 : !data.groups.some((g) => g.key === x.k)) as slot (slot.k)}
            <a class="slot" href="/settings/connections"><span>{slot.l}</span><span class="add">+ Add</span></a>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if showDetail && data.detail}
    <div class="rail">
      {#if phone.current}
        <a class="back" href="/wealth">‹ Wealth</a>
        <div class="phone-hero">{@render hero()}</div>
      {/if}
      {#snippet body()}
        {#if data.detail?.kind === 'investment'}
          <InvestmentDetail inv={data.detail.inv} onclose={phone.current ? undefined : close} />
        {:else if data.detail?.kind === 'loan'}
          <LoanDetail loan={data.detail.loan} paidOff={data.detail.paidOff} onclose={phone.current ? undefined : close} />
        {/if}
      {/snippet}
      {#if data.detail?.kind === 'account'}
        <AccountDetail a={data.detail.account} categories={data.detail.categories} onclose={phone.current ? undefined : close} />
      {:else if phone.current}
        <Card pad="body">{@render body()}</Card>
      {:else}
        <DetailPanel label="Account" onclose={close}>{@render body()}</DetailPanel>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* A group's total, masked like every figure (Section's note is plain text). */
  .gtotal {
    font-size: 13px;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .wealth {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--rail-w);
    gap: 32px;
    align-items: start;
    line-height: normal;
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

  :global(.nw-card) {
    padding: 22px 24px 18px !important;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }

  .cap {
    font-size: 14px;
    color: var(--ink-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .all {
    flex: none;
    font-size: 14px;
    font-weight: 500;
    color: var(--accent-text);
  }

  .phone-hero {
    margin-bottom: 16px;
  }

  .big {
    font-size: var(--fs-hero-desktop);
    font-weight: 500;
    letter-spacing: var(--ls-hero);
    line-height: 1.1;
  }

  .change {
    margin-top: 4px;
    font-size: 15px;
    color: var(--ink-2);
  }

  .change :global(.figure) {
    color: var(--ink-2);
  }

  .arow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 12px;
    gap: 12px;
    align-items: center;
    padding: 14px 20px;
    border-top: 1px solid var(--line);
    color: var(--ink);
  }

  .arow:first-child {
    border-top: 0;
  }

  .arow:hover {
    background: var(--pill);
  }

  .arow.sel {
    background: var(--selected-row);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .who {
    display: flex;
    flex-direction: column;
    gap: 2px;
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

  .bal {
    font-size: 16px;
  }

  .paid {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ok {
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

  .chev {
    color: var(--ink-3);
  }

  .none {
    margin: 0;
  }

  .slots {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .slot {
    display: flex;
    justify-content: space-between;
    padding: 14px 18px;
    border: 1.5px dashed var(--line);
    border-radius: var(--r-field);
    color: var(--ink-2);
    font-size: 15px;
  }

  .slot:hover {
    background: var(--surface);
  }

  .add {
    color: var(--accent-text);
    font-weight: 500;
  }

  .back {
    display: inline-block;
    margin-bottom: 14px;
    font-size: 16px;
    font-weight: 500;
    color: var(--accent-text);
  }

  @media (max-width: 1100px) {
    .wealth {
      grid-template-columns: minmax(0, 1fr) 360px;
    }
  }

  @media (max-width: 760px) {
    .wealth {
      grid-template-columns: minmax(0, 1fr);
    }

    .main {
      gap: 24px;
    }

    .big {
      font-size: var(--fs-hero-phone);
    }

    .arow {
      padding: 14px 16px;
    }
  }
</style>
