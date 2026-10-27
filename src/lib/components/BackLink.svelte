<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';

  /**
   * The way out of a page that is not in the nav.
   *
   * Several routes are reached from somewhere specific rather than from the
   * sidebar — Security, Users and Help from Settings; Import from Transactions;
   * an import batch from Import. For those the nav offers no route back, so the
   * only exits are the browser's own Back button and picking an unrelated tab,
   * which leaves the page reading as a dead end.
   *
   * It points at where the page is reached *from*, not at whatever the history
   * stack happens to hold: a browser Back is already one keypress away, and a
   * link that lands somewhere different every time is worse than no link.
   */
  let { href, label }: { href: string; label: string } = $props();
</script>

<a class="back" {href}>
  <span class="arrow" aria-hidden="true"><Icon name="up" size={15} /></span>
  {label}
</a>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: var(--space-3);
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .back:hover {
    color: var(--accent);
  }

  /* The up arrow rotated, rather than a second glyph in the set that exists
     only to point left. */
  .arrow {
    display: grid;
    place-items: center;
    transform: rotate(-90deg);
  }
</style>
