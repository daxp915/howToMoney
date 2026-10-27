<script lang="ts">
  import Money from '$lib/components/ui/Money.svelte';
  import Tip from '$lib/components/ui/Tip.svelte';
  import { accountDisplayName, institutionName, lastFour } from '$lib/accountName';
  import { drillHref } from '$lib/drill';
  import { usd } from '$lib/money';
  import type { loadInvestments } from './investments.server';

  /**
   * A brokerage: how it got here -- the period's starting
   * balance, what you put in, what the market added -- as one bar, then what
   * is in it as a second bar with the holdings under it. The donut and the
   * return percentage are gone: "Market added" in dollars says what happened.
   */
  let { inv, onclose }: { inv: Awaited<ReturnType<typeof loadInvestments>>; onclose?: () => void } = $props();

  const acct = $derived(inv.accounts[0]);
  const since = $derived(
    inv.hasData
      ? new Date(inv.startDay + 'T12:00:00').toLocaleDateString('en-US', inv.clamped ? { month: 'short', day: 'numeric' } : { month: 'long' })
      : ''
  );

  const CLASS_ORDER = ['us', 'intl', 'target', 'bonds', 'other', 'cash'];
  const CLASS_COLOR: Record<string, string> = {
    us: 'var(--series-1)',
    intl: 'var(--series-2)',
    target: 'var(--series-2)',
    bonds: 'var(--series-3)',
    other: 'var(--series-3)',
    cash: 'var(--series-4)'
  };
  const holdings = $derived(
    inv.hasData ? [...inv.holdings].sort((a, b) => CLASS_ORDER.indexOf(a.kind) - CLASS_ORDER.indexOf(b.kind) || b.value - a.value) : []
  );
  const stocks = $derived(
    holdings.filter((h) => ['us', 'intl', 'target'].includes(h.kind)).reduce((s, h) => s + h.share, 0)
  );
</script>

{#if acct}
  <div class="inv">
    <div class="top">
      <span class="where"
        >{institutionName(acct.orgName)}{lastFour(acct.name) ? ` ··${lastFour(acct.name)}` : ''}{#if inv.syncedAt}{' '}· synced {new Date(inv.syncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{/if}</span
      >
      {#if onclose}<button type="button" class="x" aria-label="Close" onclick={onclose}>×</button>{/if}
    </div>
    <div class="name">{accountDisplayName(acct)}</div>
    {#if inv.hasData}
      <div class="worth"><Money value={inv.worth} /></div>

      {@const r = inv.result}
      {@const parts = [
        { label: `Balance in ${since}`, value: r.start, color: 'var(--series-4)', sign: false },
        { label: 'You put in', value: r.putIn, color: 'var(--money-in)', sign: true },
        { label: 'Market added', value: r.market, color: 'var(--series-1)', sign: true }
      ]}
      <div class="section-label">How it got here</div>
      <div class="bar" aria-hidden="true">
        {#each parts.filter((p) => p.value > 0) as p (p.label)}<span style="flex: {p.value} 1 0; background: {p.color}"></span>{/each}
      </div>
      <div class="legend">
        {#each parts as p (p.label)}
          <div class="lrow">
            <span class="sw" style="background: {p.color}"></span>
            <span class="lbl">{p.label}</span>
            <span class="figure" class:in={p.label === 'You put in'}
              ><span class="amt">{usd(p.value, { plus: p.sign })}</span></span
            >
          </div>
        {/each}
      </div>
      <Tip id="market-added" title="Market added">
        What the balance did beyond the money you put in: price moves, dividends and interest, together.
      </Tip>

      {#if holdings.length}
        <div class="section-label">What's in it · {Math.round(stocks * 100)}% stocks</div>
        <div class="bar" aria-hidden="true">
          {#each holdings as h (h.key)}<span style="flex: {h.value} 1 0; background: {CLASS_COLOR[h.kind]}"></span>{/each}
        </div>
        <div class="holdings">
          {#each holdings as h (h.key)}
            <div class="hrow">
              <span class="sw" style="background: {CLASS_COLOR[h.kind]}"></span>
              <span class="hname"
                ><span>{h.name}</span><span class="hmeta"
                  >{#if h.kind === 'cash'}Waiting to be invested{:else}{h.symbol ?? ''}{#if h.gain !== null}{' '}· <span class="amt">{usd(h.gain, { plus: true, cents: false })}</span> gain{/if}{/if}</span
                ></span
              >
              <span class="figure"><span class="amt">{usd(h.value)}</span></span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="foot">
        {#if inv.monthly}
          <span
            ><Money value={inv.monthly.amount} cents={false} />/mo {inv.monthly.automatic ? 'goes in automatically' : 'put in on average'}</span
          >
        {:else}<span></span>{/if}
        <a class="link" href={drillHref({ account: acct.id })}>Transactions ›</a>
      </div>
    {:else}
      <p class="none">No balance history yet. It builds up with every daily sync.</p>
      <a class="link" href={drillHref({ account: acct.id })}>Transactions ›</a>
    {/if}
  </div>
{/if}

<style>
  .inv {
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  .name {
    margin-top: 10px;
    font-size: 20px;
    font-weight: 500;
  }

  .worth {
    margin-top: -6px;
    font-size: 36px;
    letter-spacing: var(--ls-hero);
    line-height: 1.15;
  }

  .section-label {
    margin-top: 14px;
    padding: 0;
  }

  .bar {
    display: flex;
    gap: 3px;
    height: 10px;
    border-radius: 5px;
    overflow: hidden;
  }

  .legend,
  .holdings {
    display: flex;
    flex-direction: column;
  }

  .lrow,
  .hrow {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 5px 0;
    font-size: 14px;
  }

  .hrow {
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }

  .hrow:first-child {
    border-top: 0;
  }

  .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }

  .lbl {
    color: var(--ink-2);
  }

  .figure.in {
    color: var(--money-in-text);
  }

  .hname {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 15px;
  }

  .hmeta {
    font-size: 12px;
    color: var(--ink-3);
  }

  .hrow .figure {
    font-size: 15px;
  }

  .foot {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin-top: 12px;
    font-size: 14px;
    color: var(--ink-2);
  }

  .link {
    font-size: 14px;
    font-weight: 500;
    color: var(--accent-text);
    white-space: nowrap;
  }

  .none {
    margin: 0;
    font-size: 14px;
    color: var(--ink-2);
  }
</style>
