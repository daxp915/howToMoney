<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte';
  import Money from '$lib/components/ui/Money.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import type { WentRow } from '$lib/server/activity';

  /**
   * "Where it went": every spending category in the hero's window,
   * largest first. Bars are out-grey and scaled to the top row -- no track,
   * no status colour, because there is no budget here. The change line is
   * neutral ink: a rise is not "bad". Total out is the hero's figure.
   */
  let {
    rows,
    total,
    month,
    note,
    outHref
  }: {
    rows: WentRow[];
    total: number;
    month: string | null;
    note: string | null;
    outHref: string;
  } = $props();

  const SHOWN = 6;

  // Always loads collapsed; a new window (the rows change) collapses it again.
  let open = $state(false);
  $effect(() => {
    void rows;
    open = false;
  });

  const max = $derived(Math.max(1, ...rows.map((r) => r.spent)));
  const visible = $derived(open || rows.length <= SHOWN + 1 ? rows : rows.slice(0, SHOWN));
  const rest = $derived(rows.slice(SHOWN));
  const restSum = $derived(rest.reduce((s, r) => s + r.spent, 0));

  function share(v: number) {
    const p = (v / (total || 1)) * 100;
    return p > 0 && p < 0.5 ? '<1' : String(Math.round(p));
  }
</script>

<Section class="went" label={month ? `Where it went · ${month}` : 'Where it went'} note={rows.length ? note : null}>
  <Card>
    {#if rows.length === 0}
      <p class="empty">Nothing spent in this period.</p>
    {:else}
      {#each visible as r (r.key)}
        <div class="row">
          <div class="name">
            {#if r.uncategorized}
              <a class="pick" href={r.href}>Uncategorized · pick a category</a>
            {:else}
              <span class="nm">{r.icon ? `${r.icon} ` : ''}{r.name}</span>
            {/if}
            {#if r.change !== null}
              <span class="chg desk">{r.change > 0 ? '↑' : '↓'} <Money value={Math.abs(r.change)} cents={false} /></span>
            {/if}
          </div>
          <span class="fig"><Money value={r.spent} cents={false} href={r.href} /></span>
          <div class="line2">
            <span class="bar" style="width: {(r.spent / max) * 100}%"></span>
            <span class="pct"><span class="pmask">{share(r.spent)}%</span></span>
            <span class="chg phone"
              >{#if r.change !== null}{r.change > 0 ? '↑' : '↓'} <Money value={Math.abs(r.change)} cents={false} />{/if}</span
            >
          </div>
        </div>
      {/each}
      {#if rows.length > SHOWN + 1}
        <button type="button" class="more" aria-expanded={open} onclick={() => (open = !open)}>
          {#if open}Show fewer{:else}+ {rest.length} more · <Money value={restSum} cents={false} />{/if}
          <span class="caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      {/if}
      <div class="row total">
        <span class="k">Total out</span>
        <span class="fig"><Money value={total} cents={false} href={outHref} /></span>
      </div>
    {/if}
  </Card>
</Section>

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(0, 220px) minmax(0, 1fr) 96px 44px;
    gap: 16px;
    align-items: center;
    min-height: 52px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--line);
    box-sizing: border-box;
  }

  .name {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .nm {
    overflow: hidden;
    font-size: 16px;
    color: var(--ink);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .pick {
    align-self: flex-start;
    padding: 3px 10px;
    border: 1px dashed var(--accent);
    border-radius: var(--r-pill);
    font-size: 13px;
    font-weight: 500;
    color: var(--accent-text);
    white-space: nowrap;
  }

  .chg {
    font-size: 14px;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .chg.phone {
    display: none;
  }

  .chg :global(.figure) {
    font-weight: 400;
  }

  .bar {
    display: block;
    min-width: 4px;
    height: 8px;
    border-radius: 4px;
    background: var(--money-out);
  }

  .fig {
    font-size: 16px;
    text-align: right;
  }

  .pct {
    font-size: 14px;
    color: var(--ink-3);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .more {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 52px;
    margin: 0;
    padding: 0 20px;
    border: 0;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    background: none;
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    color: var(--accent-text);
    text-align: left;
    cursor: pointer;
  }

  .more :global(.figure) {
    color: inherit;
  }

  .caret {
    margin-left: auto;
    font-size: 12px;
  }

  .total {
    min-height: 0;
    padding: 14px 20px;
    border-bottom: 0;
    background: var(--panel);
  }

  .total .k {
    grid-column: 1 / 3;
    font-size: 15px;
    color: var(--ink-2);
  }

  .empty {
    margin: 0;
    padding: 18px 20px;
    font-size: 16px;
    color: var(--ink-2);
  }

  /* Desktop: the second line's pieces are cells of the row's own grid. */
  .line2 {
    display: contents;
  }

  .line2 > .bar {
    grid-column: 2;
    grid-row: 1;
  }

  .row > .fig {
    grid-column: 3;
    grid-row: 1;
  }

  .line2 > .pct {
    grid-column: 4;
    grid-row: 1;
  }

  .total > .fig {
    grid-column: 3;
  }

  /* Hide amounts: a share reveals proportions, so it masks too. */
  :global(html[data-hide-amounts]) .pmask {
    display: inline-block;
    position: relative;
    width: 1.3em;
    overflow: clip;
    white-space: nowrap;
    text-indent: 3em;
    vertical-align: bottom;
  }

  :global(html[data-hide-amounts]) .pmask::before {
    content: '••%';
    position: absolute;
    right: 0;
    top: 0;
    text-indent: 0;
  }

  /* Phone: name and amount on the first line; bar, share and change under. */
  @media (max-width: 760px) {
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px 12px;
      min-height: 44px;
      padding: 12px 16px;
    }

    .row > .fig {
      grid-column: 2;
    }

    .fig :global(.figure) {
      padding: 12px 0;
      margin: -12px 0;
    }

    .line2 {
      display: grid;
      grid-column: 1 / -1;
      grid-template-columns: minmax(0, 1fr) 36px 68px;
      gap: 10px;
      align-items: center;
    }

    .line2 > .bar,
    .line2 > .pct {
      grid-row: auto;
      grid-column: auto;
    }

    .bar {
      height: 6px;
      border-radius: 3px;
    }

    .chg.desk {
      display: none;
    }

    .chg.phone {
      display: block;
      text-align: right;
    }

    .more {
      padding: 0 16px;
    }

    .total {
      padding: 14px 16px;
    }

    .total .k {
      grid-column: 1;
    }

    .total > .fig {
      grid-column: 2;
    }
  }
</style>
