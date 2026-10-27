<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { tips } from '$lib/tips.svelte';

  /**
   * A one-time tip: --tip-bg bubble, 15/600 title, 14 body, an inverted
   * "Got it". Shown until dismissed, then never again (persisted per user).
   * `style` positions a floating tip over a chart; inline otherwise.
   * `step` ("1 OF 2") and `next` make it part of a short sequence.
   */
  let {
    id,
    title,
    children,
    style = '',
    floating = false,
    step,
    next,
    onskip,
    when = true
  }: {
    id: string;
    title: string;
    children: Snippet;
    style?: string;
    floating?: boolean;
    step?: string;
    next?: () => void;
    onskip?: () => void;
    when?: boolean;
  } = $props();

  const show = $derived(
    when && !!page.data.user && !tips.dismissed(id, page.data.preferences?.dismissedTips)
  );
</script>

{#if show}
  <div class="tip" class:floating {style} role="note">
    <div class="txt">
      {#if step}<span class="step">{step}</span>{/if}
      <span class="title">{title}</span>
      <span class="body">{@render children()}</span>
    </div>
    <div class="acts">
      {#if onskip}<button type="button" class="skip" onclick={onskip}>Skip tips</button>{/if}
      {#if next}
        <button type="button" class="got" onclick={next}>Next</button>
      {:else}
        <button type="button" class="got" onclick={() => tips.dismiss(id)}>Got it</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .tip {
    display: flex;
    gap: 16px;
    align-items: center;
    padding: 18px 20px;
    border-radius: 16px;
    background: var(--tip-bg);
    color: var(--tip-ink);
    line-height: normal;
    text-align: left;
  }

  .floating {
    position: absolute;
    z-index: 3;
    width: 300px;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding: 16px 18px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  }

  .txt {
    flex: 1 1 0%;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .step {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--ls-label);
    color: var(--tip-ink-2);
  }

  .title {
    font-size: 15px;
    font-weight: 600;
  }

  .body {
    font-size: 14px;
    line-height: 1.45;
    color: var(--tip-ink-2);
  }

  .acts {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .floating .acts {
    justify-content: flex-start;
  }

  /* A 300px bubble placed by percentage runs off a phone's right edge (Goals'
     tick tip ended at 449px on a 402px screen). On a phone it spans its
     container instead; !important because the placement is an inline style,
     and that style may centre it with a transform (Home's does). */
  @media (max-width: 760px) {
    .floating {
      left: 0 !important;
      right: 0;
      transform: none !important;
      width: auto;
    }
  }

  .got,
  .skip {
    min-height: 0;
    margin: 0;
    border: 0;
    border-radius: var(--r-pill);
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .got {
    padding: 10px 16px;
    background: var(--tip-ink);
    color: var(--tip-bg);
  }

  .got:hover {
    background: var(--tip-ink);
    filter: brightness(0.94);
  }

  .skip {
    padding: 10px 4px;
    background: transparent;
    color: var(--tip-ink-2);
  }

  .skip:hover {
    background: transparent;
    color: var(--tip-ink);
  }

  .got:active,
  .skip:active {
    transform: none;
  }
</style>
