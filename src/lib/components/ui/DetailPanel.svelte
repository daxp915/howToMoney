<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The desktop master/detail panel: the right column's section, sticky under
   * the top bar, filled by the selected row. Esc closes it.
   */
  let {
    label,
    onclose,
    hideLabel = false,
    sticky = true,
    children
  }: {
    label: string;
    onclose?: () => void;
    /** Something else heads the panel (Wealth's "‹ Visa ··1954"). */
    hideLabel?: boolean;
    /** Off when more content follows the panel in its column (Wealth's Recent). */
    sticky?: boolean;
    children: Snippet;
  } = $props();

  function key(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !onclose) return;
    const el = e.target as HTMLElement | null;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? '')) {
      el?.blur();
      return;
    }
    onclose();
  }
</script>

<svelte:window onkeydown={key} />

<section class="dp" class:static={!sticky} aria-label={label}>
  {#if !hideLabel}<h2 class="section-label">{label}</h2>{/if}
  <div class="card2">{@render children()}</div>
</section>

<style>
  .dp {
    position: sticky;
    top: calc(var(--topbar-h) + 24px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: calc(100vh - var(--topbar-h) - 48px);
    min-width: 0;
  }

  h2.section-label {
    margin: 0;
  }

  .dp.static {
    position: static;
    max-height: none;
  }

  .card2 {
    background: var(--surface);
    border-radius: var(--r-card);
    box-shadow: var(--shadow);
    padding: 20px 22px;
    overflow-y: auto;
    line-height: normal;
  }
</style>
