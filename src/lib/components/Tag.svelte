<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A status: "On track", "Nearly spent", "short". Smaller and quieter than a
   * Chip, and never interactive -- a tag describes, a chip is a thing.
   */
  let {
    tone = 'neutral',
    size = 'md',
    children
  }: {
    tone?: 'good' | 'warn' | 'neutral';
    size?: 'md' | 'sm';
    children: Snippet;
  } = $props();
</script>

<span class="tag {tone} {size}">{@render children()}</span>

<style>
  .tag {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: var(--radius-pill);
    font-family: var(--font-body);
    font-size: var(--type-tag);
    font-weight: 600;
    line-height: normal;
    white-space: nowrap;
  }

  .sm {
    padding: 3px 10px;
    font-size: var(--type-tag-sm);
  }

  .good {
    background: var(--color-sage-100);
    color: var(--color-sage-700);
  }

  .warn {
    background: var(--color-accent-100);
    color: var(--color-accent-700);
  }

  .neutral {
    background: var(--color-track);
    color: var(--color-chip-neutral-fg);
  }
</style>
