<script lang="ts">
  import type { Fig } from '$lib/advisor/figures';
  import { usd } from '$lib/money';

  /**
   * A figure opened in place: a bordered card under the block the
   * figure sits in -- what the rows are and their total, the four largest,
   * "N more" summed, then "Open in Activity ›". The rows come from
   * /api/drill, read through the same filter as the Activity list the figure
   * links to.
   */
  let { fig }: { fig: Fig } = $props();

  interface Summary {
    label: string;
    flow: '' | 'in' | 'out';
    count: number;
    total: number;
    rows: { id: string; merchant: string; postedAt: string; amount: number }[];
    rest: { count: number; total: number };
  }

  let data = $state<Summary | null>(null);
  let el: HTMLDivElement | undefined = $state();

  // Opened under the fold, it would look like the tap did nothing.
  $effect(() => {
    if (data && el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  let failed = $state(false);

  $effect(() => {
    const href = fig.href ?? '';
    const qs = href.includes('?') ? href.slice(href.indexOf('?')) : '';
    data = null;
    failed = false;
    let live = true;
    fetch(`/api/drill${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Summary) => live && (data = d))
      .catch(() => live && (failed = true));
    return () => (live = false);
  });

  // Spending reads as positive amounts, the way the answer says "you spent
  // $412"; anything else keeps its sign.
  const money = (n: number) => (data?.flow === 'out' ? usd(Math.abs(n)) : usd(n, { plus: n > 0 }));
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
</script>

<div class="rows" aria-live="polite" bind:this={el}>
  {#if data}
    <div class="head">
      <span class="lbl">{data.label}</span>
      <span class="tot"><span class="amt">{money(data.total)}</span></span>
    </div>
    {#each data.rows as r (r.id)}
      <div class="row">
        <span class="who"><span class="nm">{r.merchant}</span><span class="when">{day(r.postedAt)}</span></span>
        <span class="a"><span class="amt">{money(r.amount)}</span></span>
      </div>
    {/each}
    {#if data.rest.count > 0}
      <div class="row quiet">
        <span class="who"><span class="nm">{data.rest.count} more</span></span>
        <span class="a"><span class="amt">{money(data.rest.total)}</span></span>
      </div>
    {/if}
    {#if !data.count}<div class="row quiet"><span class="nm">No transactions behind this figure.</span></div>{/if}
  {:else if failed}
    <div class="row quiet"><span class="nm">Couldn't load these transactions.</span></div>
  {:else}
    <div class="row quiet"><span class="nm">Loading…</span></div>
  {/if}
  <a class="open" href={fig.href}>Open in Activity ›</a>
</div>

<style>
  .rows {
    border: 1px solid var(--line);
    border-radius: 16px;
    overflow: hidden;
    background: var(--surface);
    line-height: normal;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 12px 16px 4px;
  }

  .lbl {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-3);
  }

  .tot {
    font-size: 15px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    border-bottom: 1px solid var(--line);
  }

  .who {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .nm {
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .when {
    font-size: 13px;
    color: var(--ink-3);
  }

  .a {
    font-size: 15px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .quiet,
  .quiet .a {
    color: var(--ink-2);
    font-weight: 400;
  }

  .open {
    display: block;
    padding: 13px 16px;
    text-align: center;
    font-size: 15px;
    font-weight: 500;
    color: var(--accent-text);
    text-decoration: none;
  }

  .open:hover {
    background: var(--pill);
  }
</style>
