<script lang="ts">
  /**
   * Envelopes · Recurring · Goals and the like: equal segments on a --pill
   * track, the active one lifted on --surface. Always fully visible -- the
   * segments share the width rather than scrolling sideways.
   */
  let {
    items,
    value,
    onselect,
    label
  }: {
    items: { key: string; label: string; href?: string }[];
    value: string;
    onselect?: (key: string) => void;
    label: string;
  } = $props();
</script>

<div class="sc" role="tablist" aria-label={label} style="grid-template-columns: repeat({items.length}, minmax(0, 1fr))">
  {#each items as it (it.key)}
    {#if it.href}
      <a class="s" role="tab" href={it.href} aria-selected={it.key === value} data-sveltekit-noscroll>{it.label}</a>
    {:else}
      <button class="s" role="tab" type="button" aria-selected={it.key === value} onclick={() => onselect?.(it.key)}
        >{it.label}</button
      >
    {/if}
  {/each}
</div>

<style>
  .sc {
    display: grid;
    gap: 2px;
    padding: 3px;
    border-radius: var(--r-pill);
    background: var(--pill);
    line-height: normal;
  }

  .s {
    min-height: 0;
    margin: 0;
    padding: 8px 12px;
    border: 0;
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .s:hover {
    color: var(--ink);
    background: transparent;
  }

  .s:active {
    transform: none;
  }

  .s[aria-selected='true'] {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow);
  }
</style>
