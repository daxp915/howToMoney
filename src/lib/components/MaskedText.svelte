<script lang="ts">
  /**
   * Free text that may carry a figure of its own -- a bank's raw descriptor
   * like "Interest: $57.24 Late fee: $0.00". The privacy mask is keyed off
   * `.amt`, so a figure buried in a string would stay readable when someone
   * presses Hide. This splits the string and wraps each figure in one.
   */
  let { text }: { text: string } = $props();

  // A dollar sign, or a number with thousands separators or cents: "$57.24",
  // "1,200.00", "-$15". A "k" rides along: "$5k", and a bare "30k" typed into
  // a question, which in this app is money (401k and 403b are not). Other
  // bare integers are left alone -- they are store numbers and dates far more
  // often than money.
  const FIGURE =
    /(-?\$\s?\d[\d,]*(?:\.\d{1,2})?(?:[kK]\b)?|-?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|-?\d+\.\d{2}\b|(?<![\d.])(?!40[13]k)\d+(?:\.\d+)?[kK]\b)/g;

  const parts = $derived(text.split(FIGURE));
</script>

{#each parts as part, i (i)}{#if i % 2}<span class="amt">{part}</span>{:else}{part}{/if}{/each}
