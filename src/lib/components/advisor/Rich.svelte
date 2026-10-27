<script lang="ts">
  import { segments, type Fig } from '$lib/advisor/figures';
  import Figure from './Figure.svelte';

  /** Text with `{{placeholders}}`, each rendered as its own Figure -- the
   *  only way a figure inside a sentence can be masked and linked. Inside a
   *  sentence the words say "over"; only a tile appends it. */
  let { text, figures }: { text: string; figures: Record<string, Fig> } = $props();
</script>

{#each segments(text) as s, i (i)}{#if 'fig' in s}<Figure fig={figures[s.fig]} over={false} />{:else}{s.text}{/if}{/each}
