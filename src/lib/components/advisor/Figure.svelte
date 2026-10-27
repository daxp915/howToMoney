<script lang="ts">
  import { formatFig, isMasked, type Fig } from '$lib/advisor/figures';
  import { useOpener, type Zone } from './figureOpen';

  /**
   * One figure the app worked out (handoff 7a "Figure link"): its own element,
   * bold, with a dotted underline. Money goes through the privacy mask; a
   * percentage, a month count or a date gives nothing away and is left
   * readable.
   *
   * Inside an answer, a figure that is a sum of transactions opens them in
   * place: tapping it toggles a card of its rows under the block it
   * sits in, and it wears the accent wash while open. Elsewhere it is a link
   * to those rows in Activity.
   */
  let { fig, over = true }: { fig: Fig | undefined; over?: boolean } = $props();

  const opener = useOpener();
  const text = $derived(fig ? formatFig(fig) + (fig.tone === 'over' && over ? ' over' : '') : '—');
  const open = $derived(!!fig && !!opener?.isOpen(fig));

  function toggle(e: MouseEvent) {
    if (!fig) return;
    const zone = ((e.currentTarget as HTMLElement).closest('[data-zone]')?.getAttribute('data-zone') ?? 'prose') as Zone;
    opener?.toggle(fig, zone);
  }
</script>

{#if fig?.href?.startsWith('/transactions') && opener}
  <button
    type="button"
    class="fig btn"
    class:amt={isMasked(fig)}
    class:over={fig.tone === 'over'}
    class:open
    aria-expanded={open}
    aria-label={fig.label ? `${fig.label}: show the transactions` : undefined}
    onclick={toggle}>{text}</button
  >
{:else if fig?.href}
  <a class="fig" class:amt={isMasked(fig)} class:over={fig.tone === 'over'} href={fig.href}>{text}</a>
{:else}
  <span class="fig" class:amt={fig && isMasked(fig)} class:over={fig?.tone === 'over'}>{text}</span>
{/if}

<style>
  .fig {
    color: inherit;
    font-weight: 700;
    text-decoration: underline 1.5px dotted var(--color-faint);
    text-underline-offset: 4px;
    white-space: nowrap;
  }
  a.fig:hover,
  .btn:hover {
    text-decoration-color: currentColor;
  }
  /* A figure is a word in a sentence: reset everything the global button
     rule sets. */
  .btn {
    display: inline;
    min-height: 0;
    margin: 0;
    padding: 0 3px;
    margin-inline: -3px;
    border: 0;
    border-radius: 4px;
    background: none;
    box-shadow: none;
    font: inherit;
    font-weight: 500; /* figures are 500 */
    line-height: inherit;
    text-align: inherit;
    text-decoration: underline 1.5px dotted var(--accent);
    text-underline-offset: 4px;
    cursor: pointer;
  }
  .btn.open {
    background: var(--accent-soft);
  }
  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .over {
    color: var(--color-accent-700);
  }
</style>
