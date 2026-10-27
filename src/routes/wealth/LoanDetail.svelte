<script lang="ts">
  import { act } from '$lib/client/act';
  import Money from '$lib/components/ui/Money.svelte';
  import { addMonths, projectPayoff } from '$lib/loanMath';
  import { usd } from '$lib/money';
  import { toast } from '$lib/toast.svelte';
  import { drillHref } from '$lib/drill';
  import { accountDisplayName } from '$lib/accountName';
  import type { Loan } from '$lib/server/loans';

  /**
   * A loan: what is owed and when it ends, a paid bar, the payment
   * facts, "What if I paid more?" and the loans already paid off. Without a
   * rate the payoff is the earliest it could end (0%), and says so.
   */
  let { loan, paidOff, onclose }: { loan: Loan; paidOff: Loan[]; onclose?: () => void } = $props();

  const monthYear = (d: string | null) =>
    d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null;
  const short = (d: string | null) =>
    d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';

  const end = $derived(loan.payoff?.date ?? loan.earliest?.date ?? null);
  const left = $derived(loan.payoff?.payments ?? loan.earliest?.payments ?? null);
  const paidShare = $derived(loan.paidTotal + loan.owed > 0 ? loan.paidTotal / (loan.paidTotal + loan.owed) : 0);
  const apr = $derived(loan.rate?.apr ?? 0);
  const inDays = $derived(
    loan.nextDue ? Math.round((new Date(loan.nextDue + 'T12:00:00').getTime() - Date.now()) / 864e5) : null
  );

  let extra = $state(100);
  const whatIf = $derived.by(() => {
    if (!loan.payment || loan.owed <= 0) return null;
    const p = projectPayoff(loan.owed, loan.payment + extra, apr);
    if (!p || left === null) return null;
    const date = addMonths(new Date(), p.payments);
    return {
      date: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      sooner: left - p.payments
    };
  });

  let editingRate = $state(false);
  let rate = $state('');
  async function saveRate() {
    editingRate = false;
    try {
      await act('setRate', { id: loan.id, rate }, { path: location.pathname });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    }
  }
</script>

<div class="loan">
  <div class="top">
    <span class="where">Loan{loan.orgName ? ` · ${loan.orgName}` : ''}{loan.last4 ? ` ··${loan.last4}` : ''}</span>
    {#if onclose}<button type="button" class="x" aria-label="Close" onclick={onclose}>×</button>{/if}
  </div>
  {#if loan.paidOff}
    <div class="big"><span class="chk">✓</span> Paid off</div>
    <p class="sub">Last payment {short(loan.lastPaid)}.</p>
  {:else}
    <div class="big"><Money value={loan.owed} href={drillHref({ account: loan.id })} /> <span class="unit">owed</span></div>
    {#if end}<p class="sub">Paid off by {monthYear(end)}{loan.rate ? '' : ' at the earliest'}</p>{/if}
    <div class="paid" aria-hidden="true"><span style="width: {paidShare * 100}%"></span></div>
    <div class="paidrow">
      <span><Money value={loan.paidTotal} cents={false} /> paid</span>
      {#if left !== null}<span>{left} payment{left === 1 ? '' : 's'} left</span>{/if}
    </div>

    <div class="section-label">Payments</div>
    <div class="kv">
      {#if loan.payment}
        <div><span class="k">Monthly payment<small>{loan.automatic ? 'Automatic' : 'From your payments'}</small></span><Money value={loan.payment} /></div>
      {/if}
      {#if loan.nextDue}
        <div>
          <span class="k"
            >Next due<small>{inDays !== null && inDays >= 0 ? `In ${inDays} day${inDays === 1 ? '' : 's'}` : 'Late'}</small></span
          ><b>{new Date(loan.nextDue + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b>
        </div>
      {/if}
      <div>
        <span class="k"
          >Interest rate<small
            >{loan.rate?.source === 'entered' ? 'Entered' : loan.rate ? 'Estimated' : 'Not known yet'} ·
            <button type="button" class="inline" onclick={() => ((rate = loan.enteredRate?.toString() ?? ''), (editingRate = true))}
              >{loan.rate?.source === 'entered' ? 'Change it' : 'Enter it'}</button
            ></small
          ></span
        >
        {#if editingRate}
          <input
            class="rate"
            inputmode="decimal"
            aria-label="Annual interest rate, percent"
            bind:value={rate}
            onblur={saveRate}
            onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        {:else}
          <b>{loan.rate ? `${loan.rate.apr.toFixed(2).replace(/\.?0+$/, '')}%` : '—'}</b>
        {/if}
      </div>
      {#if loan.payoff}
        <div><span class="k">Interest still to pay<small>At this rate</small></span><Money value={loan.payoff.interest} /></div>
      {/if}
    </div>

    {#if whatIf}
      <div class="section-label">What if I paid more?</div>
      <div class="whatif">
        <div class="wi-top"><span>Extra each month</span><b>+{usd(extra, { cents: false })}</b></div>
        <input type="range" min="0" max="1000" step="25" bind:value={extra} aria-label="Extra each month" />
        <p>
          {#if extra === 0}Move the slider to see how much sooner it ends.{:else}Paid off <b>{whatIf.date}</b>{whatIf.sooner > 0
              ? `, ${whatIf.sooner} month${whatIf.sooner === 1 ? '' : 's'} sooner.`
              : '.'}{/if}
        </p>
      </div>
    {/if}
  {/if}

  {#if paidOff.length}
    <div class="section-label">Paid off</div>
    <div class="kv">
      {#each paidOff as p (p.id)}
        <div>
          <span class="k po"><span class="chk sm">✓</span>{accountDisplayName(p)}{p.last4 ? ` ··${p.last4}` : ''}</span><small class="d">{short(p.lastPaid)}</small>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .loan {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .where {
    font-size: 13px;
    color: var(--ink-3);
  }

  .x {
    min-height: 0;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--ink-3);
    font-size: 18px;
    cursor: pointer;
  }

  .big {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 36px;
    letter-spacing: var(--ls-hero);
    line-height: 1.15;
  }

  .unit {
    font-size: 18px;
    color: var(--ink-2);
    letter-spacing: 0;
  }

  .sub {
    margin: -4px 0 6px;
    font-size: 15px;
    color: var(--ink-2);
  }

  .paid {
    height: 8px;
    border-radius: 4px;
    background: var(--track);
    overflow: hidden;
  }

  .paid span {
    display: block;
    height: 100%;
    background: var(--ink);
    border-radius: 4px;
  }

  .paidrow {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    color: var(--ink-3);
  }

  .section-label {
    margin-top: 16px;
    padding: 0;
  }

  .kv > div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-top: 1px solid var(--line);
    font-size: 15px;
  }

  .kv > div:first-child {
    border-top: 0;
  }

  .k {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .k small,
  .d {
    font-size: 12px;
    color: var(--ink-3);
  }

  b {
    font-weight: 500;
  }

  .inline {
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    cursor: pointer;
  }

  .rate {
    width: 90px;
    min-height: 0;
    padding: 6px 10px;
    border-radius: 8px;
    text-align: right;
  }

  .whatif {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    border-radius: var(--r-tile);
    background: var(--pill);
  }

  .wi-top {
    display: flex;
    justify-content: space-between;
    font-size: 15px;
  }

  .whatif input {
    min-height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    accent-color: var(--accent);
  }

  .whatif p {
    margin: 0;
    font-size: 14px;
    color: var(--ink-2);
  }

  .whatif p b {
    color: var(--ink);
  }

  .chk {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--ok);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 700;
    align-self: center;
  }

  .chk.sm {
    width: 18px;
    height: 18px;
    font-size: 10px;
  }

  .po {
    flex-direction: row;
    align-items: center;
    gap: 10px;
  }
</style>
