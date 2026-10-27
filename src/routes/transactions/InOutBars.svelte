<script lang="ts">
  import PeriodSelector from '$lib/components/ui/PeriodSelector.svelte';
  import { maskedMoney } from '$lib/privacy.svelte';

  /**
   * Activity's hero chart: grouped in/out bars per month, money in
   * teal and money out grey, 14px wide with 4/4/2/2 corners. The selected
   * month is in full colour, the rest at 55%; with none selected (the whole
   * period,  every month is. Tapping a month selects it, tapping it
   * again goes back to the period; the period selector floats over the
   * bottom edge.
   */
  type Bar = { month: string; label: string; income: number; spending: number };
  let {
    bars,
    selected,
    periods,
    period,
    monthHref
  }: {
    bars: Bar[];
    selected: string;
    periods: { key: string; label: string; href: string }[];
    period: string;
    monthHref: (month: string) => string;
  } = $props();

  const max = $derived(Math.max(1, ...bars.flatMap((b) => [b.income, b.spending])));
  const pct = (v: number) => `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%`;
</script>

<div class="wrap">
  <div class="cols" class:all={!selected} style="grid-template-columns: repeat({bars.length}, minmax(0, 1fr))">
    {#each bars as b (b.month)}
      <a
        class="col"
        class:on={b.month === selected}
        href={monthHref(b.month)}
        data-sveltekit-noscroll
        data-sveltekit-keepfocus
        aria-label="{b.label}: {maskedMoney(b.income)} in, {maskedMoney(b.spending)} out"
        aria-current={b.month === selected ? 'true' : undefined}
      >
        <span class="pair">
          <span class="in" style="height: {pct(b.income)}"></span>
          <span class="out" style="height: {pct(b.spending)}"></span>
        </span>
        <span class="lbl">{b.label}</span>
      </a>
    {/each}
  </div>
  <PeriodSelector options={periods} value={period} />
</div>

<style>
  .wrap {
    position: relative;
    margin-top: 20px;
    padding-bottom: 58px;
  }

  .cols {
    display: grid;
    gap: 12px;
    align-items: end;
    height: 150px;
  }

  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    height: 100%;
    min-width: 0;
  }

  .pair {
    display: flex;
    gap: 4px;
    align-items: flex-end;
    height: 100%;
    opacity: 0.55;
    transition: opacity var(--step);
  }

  .col:hover .pair,
  .col.on .pair,
  .all .pair {
    opacity: 1;
  }

  .pair span {
    width: 14px;
    border-radius: 4px 4px 2px 2px;
  }

  .in {
    background: var(--money-in);
  }

  .out {
    background: var(--money-out);
  }

  .on .in {
    background: var(--money-in-selected);
  }

  .on .out {
    background: var(--money-out-selected);
  }

  .lbl {
    font-size: 12px;
    color: var(--ink-3);
  }

  .on .lbl {
    color: var(--ink);
    font-weight: 600;
  }

  @media (max-width: 760px) {
    .cols {
      height: 110px;
    }
  }
</style>
