<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  /**
   * The handoff's buttons.
   *
   *   primary    accent fill, Caprasimo 15, 10/20 -- one per view
   *   secondary  surface, border-strong outline, Figtree 14/600, 10/20
   *   small      6/14 at 13/600, outlined ("No", "Set limit")
   *   small-dark the small button filled #201e1d ("Yes, it repeats")
   *
   * A link with `href`, otherwise a real <button>; every other attribute
   * (type, form, formaction, disabled, onclick...) passes straight through.
   *
   * The class names deliberately avoid `primary` and `ghost`: app.css styles
   * `button.primary` and `button.ghost` globally, and would dress this in the
   * old button over the top of the new one.
   */
  let {
    variant = 'secondary',
    href,
    children,
    ...rest
  }: {
    variant?: 'primary' | 'secondary' | 'small' | 'small-dark';
    href?: string;
    children: Snippet;
  } & HTMLButtonAttributes = $props();
</script>

{#if href}
  <a class="b v-{variant}" {href}>{@render children()}</a>
{:else}
  <button class="b v-{variant}" type="button" {...rest}>{@render children()}</button>
{/if}

<style>
  /* Every property the global `button` rule sets is set again here, so nothing
     of the old button (its 40px minimum height, its border) leaks through. */
  .b {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 0;
    margin: 0;
    padding: 10px 20px;
    border-radius: var(--radius-pill);
    border: 1px solid transparent;
    font-family: var(--font-body);
    font-size: 14px;
    font-weight: 600;
    line-height: normal;
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
    transition:
      background var(--step),
      border-color var(--step);
  }

  .b:focus-visible {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
    box-shadow: none;
  }

  .b:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .v-primary {
    background: var(--color-accent);
    color: var(--color-on-accent);
    font-family: var(--font-heading);
    font-size: var(--type-button-display);
    font-weight: var(--font-heading-weight);
  }

  .v-secondary {
    background: var(--color-surface);
    border-color: var(--color-border-strong);
    color: var(--color-text);
  }

  .v-small,
  .v-small-dark {
    padding: 6px 14px;
    font-size: 13px;
  }

  .v-small {
    background: transparent;
    border-color: var(--color-border-outline);
    color: var(--color-text);
  }

  .v-small-dark {
    background: var(--color-dark);
    color: var(--color-on-accent);
  }

  /* Hover steps one shade darker on each fill's own ramp. */
  .v-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .v-secondary:hover:not(:disabled),
  .v-small:hover:not(:disabled) {
    background: var(--color-inset);
  }

  .v-small-dark:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-dark) 86%, var(--color-muted));
  }
</style>
