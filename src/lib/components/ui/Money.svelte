<script lang="ts">
  import { usd, type MoneyOpts } from '$lib/money';

  /**
   * One money figure, the v2 way: weight 500, tabular, wrapped in `.amt` so
   * Hide amounts reaches it, and a link to the rows behind it whenever there
   * are rows behind it (pass `href` from drillHref). `inline` is the Advisor's
   * always-underlined variant.
   */
  let {
    value,
    href,
    inline = false,
    class: cls = '',
    ...opts
  }: {
    value: number | string | null | undefined;
    href?: string | null;
    inline?: boolean;
    class?: string;
  } & MoneyOpts = $props();

  const text = $derived(usd(value, opts));
</script>

{#if href}<a class="figure {cls}" class:figure--inline={inline} {href}><span class="amt">{text}</span></a
  >{:else}<span class="figure {cls}" class:figure--inline={inline}><span class="amt">{text}</span></span
  >{/if}
