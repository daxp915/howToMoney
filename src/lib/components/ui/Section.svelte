<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A section: a small-capitals label above, never inside, its card (v2).
   * The right side holds either a link ("Plan ›") or a note ("$1,695 of
   * $2,366 paid", a group total) -- `aside` for anything richer.
   */
  let {
    label,
    link,
    note,
    aside,
    children,
    class: cls = ''
  }: {
    label: string;
    link?: { href: string; text: string } | null;
    note?: string | null;
    aside?: Snippet;
    children: Snippet;
    class?: string;
  } = $props();
</script>

<section class="sec {cls}">
  <div class="head">
    <h2 class="section-label">{label}</h2>
    {#if aside}{@render aside()}{:else if link}<a class="link" href={link.href}>{link.text}</a
      >{:else if note}<span class="note">{note}</span>{/if}
  </div>
  {@render children()}
</section>

<style>
  .sec {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 0 4px;
    line-height: normal;
  }

  h2.section-label {
    margin: 0;
    padding: 0;
  }

  .link {
    font-size: 14px;
    font-weight: 500;
    color: var(--accent-text);
    white-space: nowrap;
  }

  .link:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .note {
    font-size: 13px;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
