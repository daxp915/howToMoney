<script lang="ts">
  /**
   * The v2 period selector: a pill of segments, 13/500, the active one on
   * --nav-on. `floating` centres it over the bottom edge of a chart (the
   * chart's container must be position: relative and leave room below).
   * Each option is a link when it has `href` (server-side periods), else a
   * button calling `onselect`.
   */
  let {
    options,
    value,
    floating = true,
    onselect,
    label = 'Period'
  }: {
    options: { key: string; label: string; href?: string }[];
    value: string;
    floating?: boolean;
    onselect?: (key: string) => void;
    label?: string;
  } = $props();
</script>

<div class="ps" class:floating role="group" aria-label={label}>
  {#each options as o (o.key)}
    {#if o.href}
      <a
        class="seg"
        href={o.href}
        aria-current={o.key === value ? 'true' : undefined}
        data-sveltekit-noscroll
        data-sveltekit-keepfocus>{o.label}</a
      >
    {:else}
      <button
        class="seg"
        type="button"
        aria-pressed={o.key === value}
        onclick={() => onselect?.(o.key)}>{o.label}</button
      >
    {/if}
  {/each}
</div>

<style>
  .ps {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    box-shadow: var(--shadow);
    line-height: normal;
  }

  .floating {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    z-index: 1;
  }

  .seg {
    min-height: 0;
    margin: 0;
    padding: 6px 12px;
    border: 0;
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .seg:hover {
    background: var(--pill);
    color: var(--ink);
  }

  .seg:active {
    transform: none;
  }

  .seg[aria-current='true'],
  .seg[aria-pressed='true'] {
    background: var(--nav-on);
    color: var(--nav-on-ink);
  }
</style>
