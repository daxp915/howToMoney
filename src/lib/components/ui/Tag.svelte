<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A v2 tag: soft background, text-tone ink, 13/600 pill. Status tones mean
   * only on track / watch / over; `accent` is for review and links; `outline`
   * is "Pending" and date pills.
   */
  let {
    tone = 'neutral',
    size = 'md',
    children
  }: {
    tone?: 'ok' | 'watch' | 'over' | 'neutral' | 'accent' | 'outline';
    size?: 'md' | 'sm';
    children: Snippet;
  } = $props();
</script>

<span class="t {tone} {size}">{@render children()}</span>

<style>
  .t {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: var(--r-pill);
    font-size: 13px;
    font-weight: 600;
    line-height: normal;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .sm {
    padding: 2px 8px;
    font-size: 12px;
  }

  .ok {
    background: var(--ok-soft);
    color: var(--ok-text);
  }

  .watch {
    background: var(--watch-soft);
    color: var(--watch-text);
  }

  .over {
    background: var(--over-soft);
    color: var(--over-text);
  }

  .neutral {
    background: var(--pill);
    color: var(--ink-2);
  }

  .accent {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .outline {
    border: 1px solid var(--line);
    color: var(--ink-2);
    padding: 3px 9px;
  }

  .outline.sm {
    padding: 1px 7px;
  }
</style>
