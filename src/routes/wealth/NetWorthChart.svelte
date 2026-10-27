<script lang="ts">
  import PeriodSelector from '$lib/components/ui/PeriodSelector.svelte';
  import Money from '$lib/components/ui/Money.svelte';
  import { maskedMoney } from '$lib/privacy.svelte';

  /**
   * Net worth over the period: one --ink line over a faint area,
   * an end dot drawn in HTML so the stretched SVG cannot squash it, and the
   * floating period selector.
   */
  let {
    points,
    periods,
    period,
    label: ariaLabel = 'Net worth by day'
  }: {
    points: { day: string; value: number }[];
    periods: { key: string; label: string; href: string }[];
    period: string;
    label?: string;
  } = $props();

  const W = 620;
  const H = 150;
  const lo = $derived(Math.min(...points.map((p) => p.value)));
  const hi = $derived(Math.max(...points.map((p) => p.value)));
  const x = (i: number) => (points.length <= 1 ? W : (i / (points.length - 1)) * W);
  const y = (v: number) => H - 6 - ((v - lo) / Math.max(hi - lo, 1)) * (H - 24);
  const line = $derived(points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' '));
  const area = $derived(`0,${H} ${line} ${W},${H}`);
  const end = $derived(points.length ? { top: (y(points[points.length - 1].value) / H) * 100 } : { top: 50 });

  /**
   * Scrubbing: hover with a mouse, tap or slide a finger on a phone, arrow
   * keys when focused. `touch-action: pan-y` keeps vertical page scrolling;
   * a horizontal slide scrubs. A touch selection stays after the finger
   * lifts (pointerleave fires on lift) until a tap lands elsewhere.
   */
  let active = $state<number | null>(null);
  let plot: HTMLDivElement;

  const multiYear = $derived(points.length > 1 && points[0].day.slice(0, 4) !== points[points.length - 1].day.slice(0, 4));
  const label = (day: string) =>
    new Date(day + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(multiYear ? { year: 'numeric' } : {})
    });

  const at = $derived.by(() => {
    if (active === null || !points[active]) return null;
    const p = points[active];
    const left = (x(active) / W) * 100;
    return { value: p.value, date: label(p.day), left, top: (y(p.value) / H) * 100 };
  });

  function pick(e: PointerEvent) {
    if (points.length === 0) return;
    const r = plot.getBoundingClientRect();
    const f = Math.min(Math.max((e.clientX - r.left) / Math.max(r.width, 1), 0), 1);
    active = Math.round(f * (points.length - 1));
  }

  function leave(e: PointerEvent) {
    if (e.pointerType === 'mouse') active = null;
  }

  function key(e: KeyboardEvent) {
    if (points.length === 0) return;
    const last = points.length - 1;
    const i = active ?? last;
    const next =
      e.key === 'ArrowLeft' ? i - 1
      : e.key === 'ArrowRight' ? i + 1
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : e.key === 'Escape' ? null
      : undefined;
    if (next === undefined) return;
    e.preventDefault();
    active = next === null ? null : Math.min(Math.max(next, 0), last);
  }

  function outside(e: PointerEvent) {
    if (active !== null && plot && !plot.contains(e.target as Node)) active = null;
  }
</script>

<svelte:window onpointerdown={outside} />

<div class="nw">
  <div
    class="plot"
    bind:this={plot}
    role="slider"
    tabindex="0"
    aria-label={ariaLabel}
    aria-valuemin={0}
    aria-valuemax={Math.max(points.length - 1, 0)}
    aria-valuenow={active ?? Math.max(points.length - 1, 0)}
    aria-valuetext={at ? `${at.date}: ${maskedMoney(at.value)}` : undefined}
    onpointerdown={pick}
    onpointermove={pick}
    onpointerleave={leave}
    onblur={() => (active = null)}
    onkeydown={key}
  >
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
      <polygon class="area" points={area} />
      <polyline class="line" points={line} />
    </svg>
    <span class="dot" style="top: calc({end.top}% - 5px)"></span>
    {#if at}
      <span class="guide" style="left: {at.left}%" aria-hidden="true"></span>
      <span class="dot dot--at" style="left: calc({at.left}% - 5px); top: calc({at.top}% - 5px)" aria-hidden="true"
      ></span>
      <span
        class="tip"
        class:tip--start={at.left < 15}
        class:tip--end={at.left > 85}
        style="left: {at.left}%"
        aria-hidden="true"
      >
        <Money value={at.value} cents={false} /><span class="tip-date">{at.date}</span>
      </span>
    {/if}
  </div>
  <PeriodSelector options={periods} value={period} />
</div>

<style>
  .nw {
    position: relative;
    margin-top: 24px;
    padding-bottom: 58px;
  }

  .plot {
    position: relative;
    height: 150px;
    touch-action: pan-y;
    cursor: crosshair;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }

  .plot:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 6px;
    border-radius: 4px;
  }

  .guide {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--ink-3);
    opacity: 0.5;
    pointer-events: none;
  }

  .dot--at {
    right: auto;
    box-shadow: 0 0 0 3px var(--surface, var(--bg));
    pointer-events: none;
  }

  .tip {
    position: absolute;
    bottom: calc(100% + 4px);
    transform: translateX(-50%);
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    white-space: nowrap;
    font-size: 13px;
    line-height: 18px;
    color: var(--ink);
    pointer-events: none;
  }

  .tip--start {
    transform: none;
  }

  .tip--end {
    transform: translateX(-100%);
  }

  .tip-date {
    color: var(--ink-3);
  }

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .area {
    fill: var(--chart-area);
  }

  .line {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }

  .dot {
    position: absolute;
    right: -5px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--ink);
  }

  @media (max-width: 760px) {
    .plot {
      height: 110px;
    }
  }
</style>
