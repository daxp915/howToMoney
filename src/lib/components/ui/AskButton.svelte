<script lang="ts">
  import { page } from '$app/state';
  import { usd } from '$lib/money';
  import { visibleTabs } from '$lib/preferences';

  /**
   * An action the app can't take yet, asked instead: "What should I
   * do with $612?". A soft accent pill with the Advisor's dot, so it reads as
   * a question rather than a command. It is a link to /advisor?view=ask&q=…,
   * which the layout turns into the Advisor layer asking exactly that, with
   * the screen as context; without JavaScript it is the Advisor page.
   *
   * The question is built from `before` + the amount + `after` so the label
   * can wrap the figure in `.amt`: a figure in a button is still a figure,
   * and Hide amounts has to reach it. Renders nothing when the Advisor is
   * switched off.
   */
  let {
    before,
    amount,
    after = '',
    full = false
  }: { before: string; amount: number; after?: string; full?: boolean } = $props();

  const figure = $derived(usd(amount, { cents: false }));
  const href = $derived(`/advisor?view=ask&q=${encodeURIComponent(`${before}${figure}${after}`)}`);
  const on = $derived(visibleTabs(page.data.preferences?.hiddenTabs ?? []).some((t) => t.href === '/advisor'));
</script>

{#if on}
  <a class="askbtn" class:full {href}><i aria-hidden="true"></i><span>{before}<span class="amt">{figure}</span>{after}</span></a>
{/if}

<style>
  .askbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px 20px;
    border-radius: var(--r-pill);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 16px;
    font-weight: 500;
    line-height: normal;
    text-decoration: none;
    white-space: nowrap;
    transition: filter var(--step);
  }

  .askbtn:hover {
    filter: brightness(0.97);
  }

  .askbtn:active {
    filter: brightness(0.92);
  }

  .askbtn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .full {
    display: flex;
    width: 100%;
  }

  i {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }

  /* The figure keeps the label's colour; it is not a link of its own. */
  .askbtn :global(.amt) {
    font-variant-numeric: tabular-nums;
  }
</style>
