<script lang="ts">
  import { maskedMoney } from '$lib/privacy.svelte';
  import Money from '$lib/components/ui/Money.svelte';
  import Tip from '$lib/components/ui/Tip.svelte';

  /**
   * Home's hero chart: this month's cumulative spending in accent,
   * last month's as a pale ghost, and the pace -- bills on their due dates,
   * everything else spread evenly -- dashed. The end of this month's line is
   * an HTML dot so the stretched SVG cannot squash it into an oval, and the
   * "$37 under" tag sits above it.
   */
  let {
    actual,
    last,
    lastLabel,
    expected,
    under,
    monthShort,
    days,
    hasBills,
    underHref,
    tipReady = true
  }: {
    actual: number[];
    last: number[];
    lastLabel: string;
    expected: number[];
    under: number;
    monthShort: string;
    days: number;
    hasBills: boolean;
    underHref: string;
    tipReady?: boolean;
  } = $props();

  const W = 620;
  const H = 160;
  const top = 14;
  const bottom = 150;

  const max = $derived(Math.max(1, ...expected, ...last, ...actual) * 1.02);
  // Day d ends at d/days of the width; every line starts from nothing at the
  // left edge, the moment before the 1st.
  const x = (d: number) => (d / days) * W;
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const pts = (vs: number[]) =>
    [`0,${bottom}`, ...vs.map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`)].join(' ');

  // The ghost is last month on this month's day axis.
  const ghost = $derived(pts(last.slice(0, days)));
  const pace = $derived(pts(expected));
  const mine = $derived(pts(actual));
  const end = $derived.by(() => {
    const v = actual.length ? actual[actual.length - 1] : 0;
    return { left: (x(actual.length) / W) * 100, top: (y(v) / H) * 100 };
  });
  const ghostEnd = $derived(last.length ? y(last[Math.min(last.length, days) - 1]) : bottom);
  const over = $derived(under < 0);
</script>

<div class="chart">
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
    {#if last.length}
      <polyline class="ghost" points={ghost} />
    {/if}
    <polyline class="pace" points={pace} />
    {#if actual.length}<polyline class="mine" points={mine} />{/if}
  </svg>
  {#if actual.length}
    <span class="dot" style="left: calc({end.left}% - 5px); top: calc({end.top}% - 5px)"></span>
    <span
      class="tag"
      class:over
      style="left: clamp(0%, calc({end.left}% - 24px), calc(100% - 110px)); top: calc({end.top}% - 46px)"
      title={maskedMoney(Math.abs(under)) + (over ? ' over pace' : ' under pace')}
      ><Money value={Math.abs(under)} cents={false} href={underHref} /> {over ? 'over' : 'under'}</span
    >
  {/if}
  {#if last.length}
    <span class="legend" style="top: calc({(ghostEnd / H) * 100}% - 22px)"><i></i>{lastLabel}</span>
  {/if}
  {#if hasBills}
    <Tip id="pace-bills" title="Bills don't count against pace" floating style="left: 18%; top: 34%" when={tipReady}>
      Rent and other bills count on their due date, so paying rent on the 1st won't show you as over. The dotted
      line is an even pace for everything else.
    </Tip>
  {/if}
</div>
<div class="axis"><span>{monthShort} 1</span><span>{monthShort} {days}</span></div>

<style>
  .chart {
    position: relative;
    height: 220px;
    margin-top: 18px;
  }

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  polyline {
    fill: none;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .ghost {
    stroke: var(--chart-ghost);
    stroke-width: 2;
  }

  .pace {
    stroke: var(--ink-3);
    stroke-width: 1.5;
    stroke-dasharray: 4 5;
  }

  .mine {
    stroke: var(--accent);
    stroke-width: 3;
  }

  .dot {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
  }

  .tag {
    position: absolute;
    padding: 4px 10px;
    border-radius: var(--r-pill);
    background: var(--ok-soft);
    color: var(--ok-text);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }

  .tag :global(.figure) {
    font-weight: 600;
  }

  .tag.over {
    background: var(--over-soft);
    color: var(--over-text);
  }

  .legend {
    position: absolute;
    right: 2%;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ink-3);
  }

  .legend i {
    width: 14px;
    height: 2px;
    border-radius: 1px;
    background: var(--chart-ghost);
  }

  .axis {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
    font-size: 13px;
    color: var(--ink-3);
  }

  @media (max-width: 760px) {
    .chart {
      height: 150px;
    }

    .chart :global(.tip.floating) {
      left: 0 !important;
      right: 0;
      top: 20% !important;
      width: auto;
    }
  }
</style>
