<script lang="ts">
  /**
   * The frame shared by Log in and Create account: the HTMFD
   * wordmark, a 32px title, labelled fields, a full-width primary button, and
   * the switch link at the bottom. A phone fills the screen with the link
   * pinned to the foot; desktop is the same 400px column centred on --bg.
   *
   * Pages use the shared Field and Btn; the few pieces only these two pages
   * have (the title, the throttled-attempt alert) are `:global` under `.auth`.
   */
  import type { Snippet } from 'svelte';

  let { children, foot }: { children: Snippet; foot: Snippet } = $props();
</script>

<div class="auth">
  <div class="col">
    <span class="wordmark">HTMFD</span>
    <div class="body">{@render children()}</div>
    <p class="foot">{@render foot()}</p>
  </div>
</div>

<style>
  .auth {
    min-height: 100vh;
    min-height: 100dvh;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-sans);
    line-height: normal;
    display: flex;
    justify-content: center;
  }

  .col {
    width: 100%;
    max-width: 448px; /* 400 + the 24px gutters */
    min-height: 100dvh;
    padding: 40px 24px 36px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .wordmark {
    font-size: 18px;
    font-weight: 600;
  }

  /* The mock's 48px spacer between two 16px gaps. */
  .body {
    margin-top: 64px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .foot {
    margin: auto 0 0;
    padding-top: 24px;
    text-align: center;
    font-size: 15px;
    color: var(--ink-2);
  }

  .foot :global(a) {
    color: var(--accent-text);
    font-weight: 500;
    text-decoration: none;
  }

  .foot :global(a:hover) {
    text-decoration: underline;
  }

  /* Desktop: the column is centred on the page rather than filling it. */
  @media (min-width: 761px) {
    .auth {
      align-items: center;
    }

    .col {
      min-height: 0;
      padding-block: 48px;
    }

    .foot {
      margin-top: 16px;
    }
  }

  .auth :global(.a-head) {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 24px; /* the 8px spacer and one more 16px gap: 40 to the first field */
  }

  .auth :global(.a-title) {
    margin: 0;
    font-size: 32px;
    font-weight: 500;
    letter-spacing: -0.01em;
    line-height: 1.15;
  }

  .auth :global(.a-lede) {
    margin: 0;
    font-size: 15px;
    line-height: 1.5;
    color: var(--ink-2);
    text-wrap: pretty;
  }

  .auth :global(.a-form) {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* The mock's 4px spacer above the button, between two 16px gaps. */
  .auth :global(.a-submit) {
    margin-top: 20px;
    padding: 15px;
  }

  /* A form error, so --over: the only non-budget use it has. */
  .auth :global(.a-alert) {
    margin: 0;
    padding: 12px 14px;
    border-radius: var(--r-field);
    background: var(--over-soft);
    color: var(--over-text);
    font-size: 14px;
    line-height: 1.45;
  }
</style>
