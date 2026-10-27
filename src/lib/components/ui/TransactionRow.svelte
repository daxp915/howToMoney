<script lang="ts">
  import { usd } from '$lib/money';
  import CategoryPill from './CategoryPill.svelte';
  import Tag from './Tag.svelte';

  export interface RowTxn {
    id: string;
    merchant: string;
    /** Signed: money out is negative. */
    amount: number;
    categoryName: string | null;
    categoryIcon: string | null;
    isTransfer: boolean;
    pending: boolean;
    /** Nobody has marked it reviewed: the accent dot. */
    unreviewed: boolean;
    /** A split parent: how many parts. */
    splitCount?: number;
    /** A split part, drawn indented under its parent. */
    splitPart?: boolean;
  }

  /**
   * One transaction, v2: cleaned merchant (16), category pill, amount (16/500).
   * Income is teal with a "+", a transfer is --ink-2 with a Transfer pill,
   * spending is --ink without a minus. Unreviewed rows carry a 7px accent dot,
   * pending ones an outlined tag, and a row without a category a dashed
   * "Pick a category".
   *
   * Wide (520px+): `1fr auto 112px` on one line. Narrow: merchant and amount
   * on line one, the pill under the merchant.
   */
  let {
    t,
    selected = false,
    dot = true,
    onclick,
    onpick,
    href
  }: {
    t: RowTxn;
    selected?: boolean;
    dot?: boolean;
    onclick?: () => void;
    onpick?: () => void;
    href?: string;
  } = $props();

  const kind = $derived(t.isTransfer ? 'transfer' : t.amount > 0 ? 'income' : 'spend');
  const text = $derived(
    kind === 'income' ? usd(t.amount, { plus: true }) : usd(t.amount, { abs: true })
  );

  /*
   * The row is not itself a button: it holds one (the category pill), and an
   * interactive element inside another is unreachable for screen readers
   * (axe nested-interactive, 54 rows on Activity). A click anywhere on the row
   * still opens it for a pointer; keyboard and screen-reader users get the
   * real button below, whose focus ring is drawn on the whole row.
   */
</script>

<div class="cq" class:part={t.splitPart} class:nodot={!dot}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <svelte:element
    this={href ? 'a' : 'div'}
    {href}
    class="trow"
    class:selected
    class:clickable={!!onclick || !!href}
    onclick={onclick}
    aria-current={selected ? 'true' : undefined}
  >
    {#if onclick && !href}
      <button
        type="button"
        class="open"
        aria-label="{t.merchant}, {text}{t.pending ? ', pending' : ''}"
        aria-pressed={selected}
        onclick={(e) => {
          e.stopPropagation();
          onclick();
        }}
      ></button>
    {/if}
    <span class="who">
      {#if dot}<span
          class="dot"
          class:on={t.unreviewed}
          role={t.unreviewed ? 'img' : undefined}
          aria-label={t.unreviewed ? 'Not reviewed' : undefined}
          aria-hidden={t.unreviewed ? undefined : 'true'}
        ></span>{/if}
      <span class="merchant">{t.merchant}</span>
      {#if t.pending}<Tag tone="outline" size="sm">Pending</Tag>{/if}
    </span>
    <span class="cat">
      {#if t.splitCount}
        <span class="splitnote">Split in {t.splitCount}</span>
      {:else if t.isTransfer}
        <CategoryPill name="Transfer" icon="↔️" />
      {:else}
        <CategoryPill
          name={t.categoryName}
          icon={t.categoryIcon}
          onclick={onpick
            ? (e) => {
                e.stopPropagation();
                onpick();
              }
            : undefined}
        />
      {/if}
    </span>
    <span class="amount figure {kind}"><span class="amt">{text}</span></span>
  </svelte:element>
</div>

<style>
  /* Present for keyboards and screen readers, invisible on the row. */
  .open {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .trow:has(.open:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .cq {
    container-type: inline-size;
    border-top: 1px solid var(--line);
  }

  .cq:first-child {
    border-top: 0;
  }

  .part .trow {
    padding-left: 34px;
    position: relative;
  }

  .part .trow::before {
    content: '';
    position: absolute;
    left: 20px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--line);
  }

  .trow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'who amount'
      'cat cat';
    row-gap: 6px;
    column-gap: 12px;
    align-items: center;
    padding: 14px 16px;
    color: var(--ink);
    line-height: normal;
    text-decoration: none;
    outline-offset: -2px;
  }

  .clickable {
    cursor: pointer;
  }

  .clickable:hover {
    background: var(--pill);
  }

  .selected,
  .selected:hover {
    background: var(--selected-row);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .who {
    grid-area: who;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 auto;
  }

  .dot.on {
    background: var(--accent);
  }

  .merchant {
    font-size: 16px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cat {
    grid-area: cat;
    display: flex;
    min-width: 0;
  }

  .splitnote {
    font-size: 13px;
    color: var(--ink-3);
  }

  .amount {
    grid-area: amount;
    font-size: 16px;
    text-align: right;
    white-space: nowrap;
  }

  .income {
    color: var(--money-in-text);
  }

  .transfer {
    color: var(--ink-2);
  }

  @container (max-width: 519px) {
    .cq:not(.nodot) .cat {
      padding-left: 15px;
    }
  }

  @container (min-width: 520px) {
    .trow {
      grid-template-columns: minmax(0, 1fr) auto 112px;
      grid-template-areas: 'who cat amount';
      column-gap: 16px;
      padding: 14px 20px 14px 14px;
    }
    .part .trow {
      padding-left: 34px;
    }
  }
</style>
