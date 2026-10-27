<script lang="ts">
  import Figure from './Figure.svelte';
  import type { DebtPayload } from '$lib/advisor/answer';

  /** 7e: the loan as it is beside the loan with the extra payment, and the
   *  two payoff dates on one time scale. */
  let { payload }: { payload: DebtPayload } = $props();

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const my = (d: string | null) =>
    d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—';
  const money = (v: number) => ({ kind: 'money' as const, value: v, href: '/wealth' });

  const now = $derived(payload.asIs);
  const more = $derived(payload.withExtra);
  const sooner = $derived(more ? now.payments - more.payments : 0);
  const share = $derived(more ? (more.payments / now.payments) * 100 : 100);
  const startLabel = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
</script>

<div class="debt">
  <div class="pair">
    <div class="side now">
      <div>
        <div class="s-title">As it is</div>
        <div class="s-sub"><Figure fig={money(now.payment)} /> a month</div>
      </div>
      <div>
        <div class="s-label">Paid off</div>
        <div class="s-date">{my(now.paidOff)}</div>
      </div>
      <div class="s-grid">
        <span class="k">Payments left</span><span class="v">{now.payments}</span>
        <span class="k">Interest still to pay</span><Figure fig={money(now.interest)} />
      </div>
    </div>
    {#if more}
      <div class="side more">
        <div class="s-top">
          <div>
            <div class="s-title"><span class="amt">With {usd.format(payload.extra)} more</span></div>
            <div class="s-sub"><Figure fig={money(more.payment)} /> a month</div>
          </div>
          {#if sooner > 0}<span class="soon">{sooner} month{sooner === 1 ? '' : 's'} sooner</span>{/if}
        </div>
        <div>
          <div class="s-label">Paid off</div>
          <div class="s-date">{my(more.paidOff)}</div>
        </div>
        <div class="s-grid">
          <span class="k">Payments left</span><span class="v">{more.payments}</span>
          <span class="k">Interest still to pay</span><Figure fig={money(more.interest)} />
        </div>
      </div>
    {/if}
  </div>

  {#if more}
    <div class="bars">
      <span class="b-k">As it is</span><span class="bar b-now"></span>
      <span class="b-k"><span class="amt">With {usd.format(payload.extra)} more</span></span><span class="bar b-more" style="width: {share}%"></span>
      <span></span>
      <div class="b-axis">
        <span>{startLabel}</span>
        <span class="mid" style="left: {share}%">{my(more.paidOff)}</span>
        <span>{my(now.paidOff)}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .debt {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .side {
    padding: 18px 20px;
    border-radius: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .now {
    background: var(--color-inset);
  }
  .more {
    padding: 16.5px 18.5px;
    background: var(--color-surface);
    border: 1.5px solid var(--color-text);
  }
  .s-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
  }
  .s-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--color-text-2);
  }
  .s-sub {
    font-size: 12.5px;
    color: var(--color-muted);
    margin-top: 2px;
  }
  .soon {
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--color-sage-100);
    color: var(--color-sage-700);
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }
  .s-label {
    font-size: 12.5px;
    color: var(--color-muted);
  }
  .s-date {
    font: 400 28px / 1.1 var(--font-heading);
    margin-top: 4px;
  }
  .s-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 12px;
    font-size: 14px;
  }
  .k {
    color: var(--color-text-2);
  }
  .v {
    font-weight: 700;
  }
  .bars {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 8px 14px;
    align-items: center;
    font-size: 13px;
  }
  .b-k {
    color: var(--color-muted);
  }
  .bar {
    height: 12px;
    border-radius: 999px;
    display: block;
  }
  .b-now {
    background: var(--color-out-more);
  }
  .b-more {
    background: var(--color-dark);
  }
  .b-axis {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--color-muted);
    position: relative;
  }
  .b-axis .mid {
    position: absolute;
    transform: translateX(-50%);
  }
  @media (max-width: 760px) {
    .pair {
      grid-template-columns: minmax(0, 1fr);
    }
    .bars {
      grid-template-columns: 96px minmax(0, 1fr);
    }
  }
</style>
