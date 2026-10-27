<script lang="ts">
  /**
   * The category on a row: emoji + name on --pill. With no category it is a
   * dashed accent "Pick a category" -- the one thing on the row that needs
   * doing. A button when `onclick` is given (opens the picker), a link with
   * `href`, otherwise plain.
   */
  let {
    name,
    icon,
    missing = false,
    chevron = false,
    selected = false,
    onclick,
    href
  }: {
    name?: string | null;
    icon?: string | null;
    missing?: boolean;
    chevron?: boolean;
    selected?: boolean;
    onclick?: (e: MouseEvent) => void;
    href?: string;
  } = $props();

  // "Uncategorized" is the absence of a category, so it asks for one.
  const empty = $derived(missing || !name || name === 'Uncategorized');
</script>

{#snippet body()}
  {#if empty}Pick a category{:else}{#if icon}<span class="ico" aria-hidden="true">{icon}</span>{/if}<span
      class="nm">{name}</span
    >{/if}{#if chevron}<span class="chev" aria-hidden="true">▾</span>{/if}
{/snippet}

{#if onclick}
  <button type="button" class="pill" class:empty class:selected {onclick}>{@render body()}</button>
{:else if href}
  <a class="pill" class:empty class:selected {href}>{@render body()}</a>
{:else}
  <span class="pill" class:empty class:selected>{@render body()}</span>
{/if}

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 0;
    max-width: 100%;
    margin: 0;
    padding: 4px 10px 4px 8px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--pill);
    color: var(--ink-2);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    line-height: normal;
    white-space: nowrap;
    justify-self: start;
    cursor: inherit;
  }

  button.pill,
  a.pill {
    cursor: pointer;
  }

  button.pill:hover,
  a.pill:hover {
    background: color-mix(in srgb, var(--pill) 80%, var(--ink) 8%);
  }

  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ico {
    font-size: 13px;
  }

  .empty {
    padding: 3px 10px;
    background: transparent;
    border: 1px dashed var(--accent);
    color: var(--accent-text);
  }

  button.empty:hover {
    background: var(--accent-soft);
  }

  .selected {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .chev {
    font-size: 11px;
    color: var(--ink-3);
  }

  button.pill:active {
    transform: none;
  }
</style>
