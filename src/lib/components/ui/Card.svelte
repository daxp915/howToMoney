<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  /**
   * The v2 card: surface, radius 18, shadow, no border in light. `pad` is
   * 'list' for a card of rows (rows carry their own padding and dividers),
   * 'body' for content, 'hero' for the one big number.
   */
  let {
    pad = 'list',
    children,
    class: cls = '',
    ...rest
  }: { pad?: 'list' | 'body' | 'hero'; children: Snippet; class?: string } & HTMLAttributes<HTMLDivElement> =
    $props();
</script>

<div class="v2card {pad} {cls}" {...rest}>{@render children()}</div>

<style>
  .v2card {
    background: var(--surface);
    border-radius: var(--r-card);
    box-shadow: var(--shadow);
    min-width: 0;
    line-height: normal;
  }

  .list {
    overflow: hidden;
  }

  .body {
    padding: 18px 20px;
  }

  .hero {
    padding: 28px 24px 18px;
    position: relative;
  }
</style>
