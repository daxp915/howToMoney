<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  /**
   * v2 buttons. primary: accent fill; secondary: surface + line; soft: accent
   * wash (full-width "Mark 4 as reviewed"); ghost: text only. A disabled
   * button keeps its label saying what is missing ("Split $129.36 of
   * $141.36"), on --track with --ink-3. A link with `href`, else a <button>.
   *
   * Every property the global `button` rule sets is reset here.
   */
  let {
    variant = 'secondary',
    size = 'md',
    full = false,
    href,
    children,
    class: cls = '',
    ...rest
  }: {
    variant?: 'primary' | 'secondary' | 'soft' | 'ghost';
    size?: 'md' | 'sm';
    full?: boolean;
    href?: string;
    children: Snippet;
    class?: string;
  } & HTMLButtonAttributes = $props();
</script>

{#if href}
  <a class="btn2 {variant} {size} {cls}" class:full {href}>{@render children()}</a>
{:else}
  <button class="btn2 {variant} {size} {cls}" class:full type="button" {...rest}>{@render children()}</button>
{/if}

<style>
  .btn2 {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 0;
    margin: 0;
    padding: 12px 20px;
    border: 1px solid transparent;
    border-radius: var(--r-pill);
    font: inherit;
    font-size: 16px;
    font-weight: 500;
    line-height: normal;
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
    transition:
      background var(--step),
      filter var(--step);
  }

  .sm {
    padding: 8px 14px;
    font-size: 14px;
  }

  .full {
    display: flex;
    width: 100%;
  }

  .primary {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .secondary {
    background: var(--surface);
    border-color: var(--line);
    color: var(--ink);
  }

  .soft {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-radius: var(--r-field);
    padding: 13px;
  }

  .ghost {
    background: transparent;
    color: var(--accent-text);
    padding-inline: 8px;
  }

  .primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .secondary:hover:not(:disabled) {
    background: var(--pill);
  }

  .soft:hover:not(:disabled) {
    filter: brightness(0.97);
  }

  .btn2:active:not(:disabled) {
    filter: brightness(0.92);
    transform: none;
  }

  .btn2:disabled {
    background: var(--track);
    border-color: transparent;
    color: var(--ink-3);
    cursor: not-allowed;
    opacity: 1;
  }

  .btn2:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
</style>
