<script lang="ts">
  import Figure from './Figure.svelte';
  import MaskedText from '$lib/components/MaskedText.svelte';
  import type { AffordPayload } from '$lib/advisor/answer';
  import type { CashEvent } from '$lib/advisor/forecast';

  /**
   * 7b / 7n: checking over the next 30 days, with the purchase (sage step
   * line over a sage-100 area) and without it (dashed), against the floor.
   * Below it, the dated moves that shape the line. Every value is the app's
   * forecast; nothing here is the model's.
   */
  let { payload }: { payload: AffordPayload } = $props();

  const DAYS = 30;
  const W = 600;
  const H = 180;

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const money = (v: number) => (v < 0 ? '−' : '') + usd.format(Math.abs(v));
  const noon = (d: string) => new Date(d + 'T12:00:00');
  const md = (d: string) => noon(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const today = $derived(payload.points[0]?.day ?? '');
  const idxOf = (d: string) => Math.round((noon(d).getTime() - noon(today).getTime()) / 86400000);

  const withIt = $derived(payload.points.slice(0, DAYS + 1));
  const without = $derived(payload.without.slice(0, DAYS + 1));
  const end = $derived(withIt.at(-1)?.day ?? today);

  // A round scale: gridlines at the largest step that still gives two or
  // three of them, and the top half a step above the highest point.
  const scale = $derived.by(() => {
    const vals = [...withIt, ...without].map((p) => p.balance).concat(payload.floor);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const steps = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 250000];
    const g = steps.find((s) => max / s <= 2.6) ?? steps.at(-1)!;
    const half = g / 2;
    const top = Math.ceil((max * 1.06) / half) * half;
    const bottom = min < 0 ? Math.floor(min / half) * half : 0;
    const lines: number[] = [];
    for (let v = g; v < top; v += g) if (v > bottom) lines.push(v);
    return { top, bottom, lines };
  });
  const y = (v: number) => ((scale.top - v) / (scale.top - scale.bottom)) * H;
  const x = (i: number) => (i / DAYS) * W;
  const pct = (v: number) => `${((y(v) / H) * 100).toFixed(1)}%`;
  const short = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : usd.format(v).replace('.00', ''));

  function step(points: { balance: number }[], close = false): string {
    if (!points.length) return '';
    let d = `M0,${y(points[0].balance).toFixed(1)}`;
    for (let i = 1; i < points.length; i++) d += ` H${x(i).toFixed(1)} V${y(points[i].balance).toFixed(1)}`;
    d += ` H${W}`;
    return close ? `${d} V${H} H0 Z` : d;
  }

  const buyDay = $derived(payload.buyDay ?? payload.asked);
  const buyIdx = $derived(Math.min(DAYS, Math.max(0, idxOf(buyDay))));
  const buyAt = $derived(withIt[buyIdx]?.balance ?? withIt[0]?.balance ?? 0);
  const low = $derived(withIt.reduce((b, p) => (p.balance < b.balance ? p : b), withIt[0]));
  const lowIdx = $derived(idxOf(low.day));
  // The purchase's label sits below-right of its dot; a low point within a
  // week of it puts its own label above instead, or the two collide.
  const crowded = $derived(Math.abs(lowIdx - buyIdx) < 8);

  const inWindow = $derived(payload.events.filter((e) => e.day <= end && e.day >= today));
  const out = $derived(inWindow.filter((e) => e.kind === 'bill' || e.kind === 'loan'));
  const comingIn = $derived(inWindow.filter((e) => e.kind === 'paycheck'));
  const moving = $derived(inWindow.filter((e) => e.kind === 'transfer'));
  const nextPay = $derived(comingIn[0] ?? null);
  const beforePay = $derived(nextPay ? out.filter((e) => e.day < nextPay.day) : out);
  const xLabels = $derived(
    [...new Set(comingIn.map((e) => e.day))].map((d) => ({ d, at: (idxOf(d) / DAYS) * 100 })).filter((l) => l.at > 8 && l.at < 88)
  );

  const fig = (e: CashEvent) => ({ kind: 'money' as const, value: Math.abs(e.amount), href: e.href ?? null });
  let all = $state(false);
</script>

{#snippet list(title: string, dot: string, rows: CashEvent[], income = false, first = false)}
  <div class="l-head {dot}" class:later={!first}><span class="dot"></span>{title}</div>
  {#each rows as e, i (i)}
    <div class="l-row">
      <span><span class="l-name"><MaskedText text={e.label} /></span> <span class="l-day">{md(e.day)}</span></span>
      <span class:income>{#if income}+{/if}<Figure fig={fig(e)} /></span>
    </div>
  {/each}
{/snippet}

<div class="afford">
  <div class="c-head">
    <span class="c-title"><span class="desk-inline">{payload.account}</span><span class="phone-inline">Checking</span>, next 30 days</span>
    <div class="legend desk-flex">
      <span><span class="sw line"></span>With the <MaskedText text={payload.what} /></span>
      <span><span class="sw dash"></span>Without it</span>
      <span><span class="sw floor"></span>Your floor</span>
    </div>
  </div>

  <div class="chart">
    <div class="ylabels desk">
      {#each scale.lines as v (v)}<span style="top: {pct(v)}"><span class="amt">{short(v)}</span></span>{/each}
      <span class="floor-l" style="top: {pct(payload.floor)}"><span class="amt">{short(payload.floor)}</span></span>
    </div>
    <div class="plot">
      {#each scale.lines as v (v)}
        <span class="grid" style="top: {pct(v)}"></span>
        <span class="yin phone" style="top: {pct(v)}"><span class="amt">{short(v)}</span></span>
      {/each}
      <span class="floor-line" style="top: {pct(payload.floor)}"></span>
      <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
        <path d={step(withIt, true)} class="area" />
        <path d={step(without)} class="without" vector-effect="non-scaling-stroke" />
        <path d={step(withIt)} class="with" vector-effect="non-scaling-stroke" />
      </svg>
      <span class="buy" style="left: calc({(buyIdx / DAYS) * 100}% - 6px); top: calc({pct(buyAt)} - 6px)"></span>
      <span class="tip desk" style="left: calc({(buyIdx / DAYS) * 100}% + 14px); top: calc({pct(buyAt)} + 10px)">
        <MaskedText text={payload.what} />
        {buyIdx === 0 ? 'today' : md(buyDay)} · <span class="amt">{money(-payload.amount)}</span>
      </span>
      <span class="lowdot" style="left: calc({(lowIdx / DAYS) * 100}% - 6px); top: calc({pct(low.balance)} - 6px)"></span>
      <span
        class="tip"
        style="left: max(0px, calc({(lowIdx / DAYS) * 100}% - 40px)); top: calc({pct(low.balance)} {crowded ? '- 38px' : '+ 12px'})"
      >
        Lowest · {md(low.day)}<span class="desk-inline"> · <span class="amt">{money(low.balance)}</span></span>
      </span>
      <span class="floor-r" style="top: calc({pct(payload.floor)} - 20px)">
        <span class="desk-inline">Your floor · <span class="amt">{money(payload.floor)}</span></span>
        <span class="phone-inline">Floor <span class="amt">{short(payload.floor)}</span></span>
      </span>
    </div>
    <span class="desk"></span>
    <div class="lane">
      {#each inWindow as e, i (i)}
        <span class="m {e.kind}" style="left: calc({(idxOf(e.day) / DAYS) * 100}% - 4.5px)"></span>
      {/each}
    </div>
    <span class="desk"></span>
    <div class="xlabels">
      <span style="left: 0">Today</span>
      {#each xLabels as l (l.d)}<span class="mid" style="left: {l.at}%">{md(l.d)}</span>{/each}
      <span style="right: 0"><span class="desk-inline">{md(end)}</span><span class="phone-inline">{noon(end).getDate()}</span></span>
    </div>
  </div>

  <div class="legend phone-flex">
    <span><span class="sw line"></span>With the <MaskedText text={payload.what} /></span>
    <span><span class="sw dash"></span>Without</span>
    <span><span class="d bill"></span>Bill</span>
    <span><span class="d paycheck"></span>Paycheck</span>
  </div>

  <div class="lists desk-grid">
    <div>{@render list('Going out', 'bill', out, false, true)}</div>
    <div>
      {@render list('Coming in', 'paycheck', comingIn, true, true)}
      {#if moving.length}{@render list('Moving', 'transfer', moving)}{/if}
    </div>
  </div>

  <div class="phone">
    {#if all}
      {@render list('Going out', 'bill', out, false, true)}
      {@render list('Coming in', 'paycheck', comingIn, true)}
      {#if moving.length}{@render list('Moving', 'transfer', moving)}{/if}
    {:else}
      <div class="ph-eyebrow">{nextPay ? `Before the ${md(nextPay.day)} paycheck` : 'Going out'}</div>
      {#each beforePay as e, i (i)}
        <div class="l-row">
          <span><span class="l-name"><MaskedText text={e.label} /></span> <span class="l-day">{md(e.day)}</span></span>
          <Figure fig={fig(e)} />
        </div>
      {/each}
      <button type="button" class="all" onclick={() => (all = true)}>All 30 days ›</button>
    {/if}
  </div>
</div>

<style>
  .afford {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .phone,
  .phone-flex,
  .phone-inline {
    display: none !important;
  }
  .desk-flex {
    display: flex;
  }
  .desk-grid {
    display: grid;
  }
  .c-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
  }
  .c-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-text-2);
  }
  .legend {
    gap: 18px;
    font-size: 12.5px;
    color: var(--color-text-2);
    font-weight: 600;
  }
  .legend > span {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .sw {
    width: 18px;
  }
  .sw.line {
    height: 3px;
    border-radius: 999px;
    background: var(--color-sage);
  }
  .sw.dash {
    border-top: 2px dashed var(--color-muted);
  }
  .sw.floor {
    border-top: 2px dashed var(--color-accent-700);
  }
  .d {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .d.bill {
    background: var(--color-accent);
  }
  .d.paycheck {
    background: var(--color-sage);
  }

  .chart {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr);
    column-gap: 10px;
    row-gap: 8px;
  }
  .ylabels {
    position: relative;
    height: 180px;
    font-size: 12px;
    color: var(--color-muted);
  }
  .ylabels > span {
    position: absolute;
    right: 0;
    transform: translateY(-50%);
  }
  .ylabels .floor-l {
    color: var(--color-accent-700);
    font-weight: 600;
  }
  .plot {
    position: relative;
    height: 180px;
  }
  .grid {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed var(--color-border-frame);
  }
  .floor-line {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 2px dashed var(--color-accent-700);
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
  .area {
    fill: var(--color-sage-100);
  }
  .without {
    fill: none;
    stroke: var(--color-muted);
    stroke-width: 2;
    stroke-dasharray: 5 4;
  }
  .with {
    fill: none;
    stroke: var(--color-sage);
    stroke-width: 2.75;
    stroke-linejoin: round;
  }
  .buy,
  .lowdot {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow: 0 0 0 3px var(--color-surface);
  }
  .buy {
    background: var(--color-accent);
  }
  .lowdot {
    background: var(--color-dark);
  }
  .tip {
    position: absolute;
    padding: 4px 10px;
    border-radius: 12px;
    background: var(--color-surface);
    border: 1px solid var(--color-border-frame);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .floor-r {
    position: absolute;
    right: 4px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--color-accent-700);
  }
  .lane {
    position: relative;
    height: 14px;
  }
  .m {
    position: absolute;
    top: 2px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    box-sizing: border-box;
  }
  .m.bill,
  .m.loan {
    background: var(--color-accent);
  }
  .m.paycheck {
    background: var(--color-sage);
  }
  .m.transfer {
    border: 2px solid var(--color-faint);
  }
  .xlabels {
    position: relative;
    height: 16px;
    font-size: 12px;
    color: var(--color-muted);
  }
  .xlabels > span {
    position: absolute;
  }
  .xlabels .mid {
    transform: translateX(-50%);
  }

  .lists {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 28px;
  }
  .l-head {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
    padding-bottom: 6px;
  }
  .l-head.later {
    padding-top: 14px;
  }
  .l-head .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    box-sizing: border-box;
  }
  .l-head.bill .dot {
    background: var(--color-accent);
  }
  .l-head.paycheck .dot {
    background: var(--color-sage);
  }
  .l-head.transfer .dot {
    border: 2px solid var(--color-faint);
  }
  .l-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    padding: 7px 0;
    border-top: 1px solid var(--color-rule);
    font-size: 14px;
  }
  .l-name {
    font-weight: 600;
  }
  .l-day {
    color: var(--color-muted);
    font-size: 12.5px;
  }
  .income,
  .income :global(.fig) {
    color: var(--color-sage-700);
    font-weight: 700;
  }

  @media (max-width: 760px) {
    .desk,
    .desk-flex,
    .desk-grid,
    .desk-inline {
      display: none !important;
    }
    .phone {
      display: block !important;
    }
    .phone-flex {
      display: flex !important;
    }
    .phone-inline {
      display: inline !important;
    }
    .afford {
      gap: 12px;
    }
    .chart {
      grid-template-columns: minmax(0, 1fr);
    }
    .plot {
      height: 140px;
    }
    .yin {
      position: absolute;
      right: 0;
      transform: translateY(-100%);
      font-size: 11.5px;
      color: var(--color-muted);
      padding-bottom: 2px;
    }
    .floor-r {
      top: auto !important;
      bottom: 6px;
    }
    .legend {
      gap: 12px;
      flex-wrap: wrap;
      font-size: 12px;
    }
    .legend > span {
      gap: 5px;
    }
    .legend .sw {
      width: 16px;
    }
    .ph-eyebrow {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--color-muted);
      padding: 6px 0;
    }
    .l-row {
      font-size: 14.5px;
      padding: 9px 0;
    }
    .all {
      all: unset;
      cursor: pointer;
      display: block;
      padding-top: 10px;
      border-top: 1px solid var(--color-rule);
      font-size: 13px;
      font-weight: 600;
      color: var(--color-accent-700);
    }
  }
</style>
