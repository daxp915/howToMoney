<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A filter chip ("To review 4", "Category ▾"): 14/500 pill on --surface with
   * the card shadow; active is the soft accent with an accent count badge.
   */
  let {
    active = false,
    count,
    href,
    onclick,
    children
  }: {
    active?: boolean;
    count?: number | null;
    href?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

{#if href}
  <a {href} class="fc" class:active data-sveltekit-noscroll>
    {@render children()}{#if count != null}<span class="n">{count}</span>{/if}
  </a>
{:else}
  <button type="button" class="fc" class:active aria-pressed={active} {onclick}>
    {@render children()}{#if count != null}<span class="n">{count}</span>{/if}
  </button>
{/if}

<style>
  .fc {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 0;
    margin: 0;
    padding: 8px 14px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--ink-2);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    line-height: normal;
    white-space: nowrap;
    cursor: pointer;
  }

  .fc:hover {
    background: var(--pill);
  }

  .fc:active {
    transform: none;
  }

  .active,
  .active:hover {
    background: var(--accent-soft);
    color: var(--accent-text);
    box-shadow: none;
  }

  .n {
    min-width: 20px;
    padding: 1px 6px;
    border-radius: var(--r-pill);
    background: var(--pill);
    color: var(--ink-2);
    font-size: 12px;
    font-weight: 600;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .active .n {
    background: var(--accent);
    color: var(--accent-ink);
  }
</style>
