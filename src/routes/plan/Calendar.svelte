<script lang="ts">
  import Money from '$lib/components/ui/Money.svelte';
  import { maskText } from '$lib/privacy.svelte';
  import { usd } from '$lib/money';
  import type { PlanEvent } from '$lib/server/plan';

  /**
   * The month's recurring calendar: 46px cells, a --pill ground on
   * days something is due, dots for what (bills --ink-2, paychecks
   * --money-in), a green check once everything that day is paid, today
   * inverted. A day with something on it is a button: `onpick` hands its
   * date to the page, which lists exactly that day's items under the
   * calendar.
   */
  let {
    from,
    label,
    today,
    events,
    out,
    income,
    outHref,
    inHref,
    selected = null,
    onpick,
    wide = false
  }: {
    from: string;
    label: string;
    today: string;
    events: PlanEvent[];
    out: number;
    income: number;
    outHref: string;
    inHref: string;
    selected?: string | null;
    onpick?: (date: string) => void;
    /** Desktop's Recurring tab: taller cells that name what is on each day. */
    wide?: boolean;
  } = $props();

  const first = $derived(new Date(from + 'T12:00:00'));
  const lead = $derived(first.getDay());
  const days = $derived(new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate());
  const iso = (d: number) => `${from.slice(0, 8)}${String(d).padStart(2, '0')}`;
  const on = (d: number) => events.filter((e) => e.date === iso(d));
</script>

<div class="cal" class:wide>
  <div class="head">
    <span class="m">{label}</span>
    <span class="tot"
      ><Money value={out} cents={false} href={outHref} class="o" /> out · <Money
        value={income}
        cents={false}
        href={inHref}
        class="i"
      /> in</span
    >
  </div>
  <div class="dow" aria-hidden="true">
    {#each ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as d, i (i)}<span>{d}</span>{/each}
  </div>
  <div class="grid">
    {#each Array(lead) as _, i (i)}<span></span>{/each}
    {#each Array(days) as _, i (i)}
      {@const d = i + 1}
      {@const evs = on(d)}
      {@const bills = evs.filter((e) => e.kind !== 'pay')}
      {@const allPaid = bills.length > 0 && bills.every((e) => e.paid)}
      <svelte:element
        this={evs.length ? 'button' : 'div'}
        type={evs.length ? 'button' : undefined}
        role={evs.length ? 'button' : undefined}
        class="cell"
        class:due={evs.length > 0}
        class:today={iso(d) === today}
        class:picked={selected === iso(d)}
        aria-pressed={evs.length ? selected === iso(d) : undefined}
        onclick={evs.length ? () => onpick?.(iso(d)) : undefined}
        title={evs.length ? evs.map((e) => `${e.name} ${maskText(usd(e.amount, { abs: true }))}`).join('\n') : undefined}
      >
        <span class="n">{d}</span>
        {#if wide && evs.length}
          <span class="names">
            {#each evs.slice(0, 2) as e, k (k)}
              <span class="nm" class:pay={e.kind === 'pay'} class:paid={e.paid}>{e.paid ? '✓ ' : ''}{e.name}</span>
            {/each}
            {#if evs.length > 2}<span class="more">+{evs.length - 2} more</span>{/if}
          </span>
        {:else if allPaid && !evs.some((e) => e.kind === 'pay' && !e.paid)}
          <span class="chk" aria-label="Paid">✓</span>
        {:else if evs.length}
          <span class="dots">
            {#each evs.slice(0, 3) as e, k (k)}<span class="dot" class:pay={e.kind === 'pay'}></span>{/each}
          </span>
        {:else}
          <span class="sp"></span>
        {/if}
      </svelte:element>
    {/each}
  </div>
</div>

<style>
  .cal {
    padding: 18px;
    line-height: normal;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 12px;
  }

  .m {
    font-size: 16px;
    font-weight: 500;
  }

  .tot {
    font-size: 13px;
    color: var(--ink-3);
  }

  .tot :global(.o) {
    color: var(--ink-2);
  }

  .tot :global(.i) {
    color: var(--money-in-text);
  }

  .dow,
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
  }

  .dow {
    margin-bottom: 6px;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }

  .cell {
    height: 46px;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  /* Every property the global button rule sets, reset. */
  button.cell {
    width: 100%;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  button.cell:hover {
    box-shadow: inset 0 0 0 1.5px var(--line);
  }

  button.cell.picked {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .n {
    font-size: 14px;
    font-weight: 400;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }

  .due {
    background: var(--pill);
  }

  .due .n {
    font-weight: 600;
    color: var(--ink);
  }

  .today {
    background: var(--ink);
  }

  .today .n {
    font-weight: 600;
    color: var(--bg);
  }

  .dots {
    display: flex;
    gap: 3px;
  }

  .wide .cell {
    height: 84px;
    align-items: stretch;
    justify-content: flex-start;
    padding: 8px;
    text-align: left;
  }

  .wide button.cell {
    padding: 8px;
  }

  .names {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .names .nm {
    font-size: 12px;
    line-height: 1.3;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .names .nm.pay {
    color: var(--money-in-text);
  }

  .names .nm.paid {
    color: var(--ink-3);
  }

  .names .more {
    font-size: 11px;
    color: var(--ink-3);
  }

  .today .names .nm,
  .today .names .more {
    color: var(--bg);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ink-2);
  }

  .dot.pay {
    background: var(--money-in);
  }

  .today .dot {
    background: var(--bg);
  }

  .sp {
    height: 6px;
  }

  .chk {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--ok);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 8px;
    font-weight: 700;
  }
</style>
