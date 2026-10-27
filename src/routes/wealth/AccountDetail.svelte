<script lang="ts">
  import Card from '$lib/components/ui/Card.svelte';
  import DetailPanel from '$lib/components/ui/DetailPanel.svelte';
  import Money from '$lib/components/ui/Money.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import TransactionRow from '$lib/components/ui/TransactionRow.svelte';
  import AddExpense from '$lib/components/AddExpense.svelte';
  import { phone } from '$lib/media.svelte';
  import { usd } from '$lib/money';
  import type { Detail, FeedRow } from '$lib/server/activity';
  import TxnDetail from '../transactions/TxnDetail.svelte';

  /**
   * A checking, savings, card or cash account in Wealth: balance,
   * this month's two figures, then its last ten transactions grouped by day
   * in one card, "All N ›" to the rest in Activity. Tapping a row swaps the
   * desktop panel to that transaction ("‹ Visa ··1954" back) or opens the
   * transaction sheet on a phone.
   *
   * A card says "Spent" and "Paid" rather than "In" and "Out": a payment is
   * money in that is not income, and purchases are out that is not yet paid.
   */
  type Account = {
    id: string;
    card: boolean;
    manual: boolean;
    name: string;
    short: string;
    where: string;
    balance: number;
    owed: boolean;
    available: number | null;
    income: number;
    spending: number;
    paid: number;
    inHref: string;
    outHref: string;
    paidHref: string;
    href: string;
    recent: FeedRow[];
    count: number;
  };
  type Cat = { id: string; name: string; icon: string | null };
  let {
    a,
    categories,
    onclose
  }: {
    a: Account;
    categories: Cat[];
    onclose?: () => void;
  } = $props();

  // ---- one transaction: desktop panel swap, phone sheet -----------------------
  let detail = $state<Detail | null>(null);
  let selectedId = $state<string | null>(null);
  let detent = $state<'medium' | 'large'>('medium');
  let loadSeq = 0;

  async function load(id: string) {
    const seq = ++loadSeq;
    const r = await fetch(`/api/transactions/${id}`);
    if (seq !== loadSeq) return;
    detail = r.ok ? await r.json() : null;
  }

  function select(id: string) {
    selectedId = id;
    detent = 'medium';
    load(id);
  }

  function back() {
    loadSeq++;
    selectedId = null;
    detail = null;
  }

  async function reload() {
    if (selectedId) await load(selectedId);
  }

  // A different account opened: start on its list, not the last one's row.
  // Keyed on the id alone -- `a` is a new object after every invalidation
  // (marking a row reviewed), which must not close the transaction.
  const accountId = $derived(a.id);
  $effect(() => {
    void accountId;
    back();
  });

  // ---- the list, by day -------------------------------------------------------
  const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
  const today = $derived(new Date().toLocaleDateString('en-CA'));
  const days = $derived.by(() => {
    const out: { key: string; label: string; total: number | null; rows: FeedRow[] }[] = [];
    for (const t of a.recent) {
      const k = dayKey(t.postedAt);
      let g = out[out.length - 1];
      if (!g || g.key !== k) {
        const d = new Date(t.postedAt);
        g = {
          key: k,
          label:
            k === today
              ? 'Today'
              : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', ''),
          total: null,
          rows: []
        };
        out.push(g);
      }
      g.rows.push(t);
      // Transfers move money between your own accounts, so a day's total
      // leaves them out; a split parent is counted through its parts.
      if (!t.isTransfer && !t.excluded) g.total = (g.total ?? 0) + t.amount;
    }
    return out;
  });

  let addingCash = $state(false);
</script>

{#snippet summary()}
  <div class="acct">
    <div class="top">
      <span class="where">{a.where}</span>
      {#if onclose}<button type="button" class="x" aria-label="Close" onclick={onclose}>×</button>{/if}
    </div>
    <div class="id">
      <span class="aname">{a.name}</span>
      <span class="abig"
        ><Money value={a.balance} href={a.href} />{#if a.owed}{' '}<span class="unit">owed</span>{/if}</span
      >
      {#if a.available !== null && Math.abs(a.available - (a.owed ? -a.balance : a.balance)) > 0.005}
        <span class="avail"><Money value={a.available} /> available</span>
      {/if}
    </div>
    <div class="pair">
      {#if a.card}
        <div><span class="k">Spent this month</span><Money value={a.spending} href={a.outHref} /></div>
        <div><span class="k">Paid this month</span><Money value={a.paid} href={a.paidHref} /></div>
      {:else}
        <div><span class="k">In this month</span><Money value={a.income} href={a.inHref} class="in" /></div>
        <div><span class="k">Out this month</span><Money value={a.spending} href={a.outHref} /></div>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet recentList()}
  <Section label="Recent" link={a.count > 0 ? { href: a.href, text: `All ${a.count} ›` } : null}>
    <Card>
      {#if a.recent.length === 0}
        <p class="none">No transactions yet.</p>
      {:else}
        {#each days as g (g.key)}
          <div class="day">
            <span class="dl">{g.label}</span>
            {#if g.total !== null && Math.abs(g.total) > 0.005}
              <span class="dt"
                ><span class="amt">{g.total < 0 ? '−' : '+'}{usd(g.total, { abs: true })}</span></span
              >
            {/if}
          </div>
          {#each g.rows as t (t.id)}
            <TransactionRow
              {t}
              selected={selectedId === t.id}
              onclick={() => select(t.splitPart && t.parentId ? t.parentId : t.id)}
              onpick={() => select(t.id)}
            />
          {/each}
        {/each}
      {/if}
      {#if a.manual}
        <button type="button" class="add" onclick={() => (addingCash = true)}>+ Cash</button>
      {/if}
    </Card>
  </Section>
{/snippet}

{#if !phone.current && detail}
  <div class="stack">
    <button type="button" class="back" onclick={back}>‹ {a.short}</button>
    <DetailPanel label="Transaction" onclose={back} hideLabel>
      <TxnDetail d={detail} {categories} mode="panel" onclose={back} {reload} />
    </DetailPanel>
  </div>
{:else}
  <div class="stack">
    {#if phone.current}
      <Card pad="body">{@render summary()}</Card>
    {:else}
      <DetailPanel label="Account" onclose={onclose} sticky={false}>{@render summary()}</DetailPanel>
    {/if}
    {@render recentList()}
  </div>
{/if}

{#if phone.current}
  <Sheet open={!!detail} bind:detent onclose={back} label="Transaction">
    {#if detail}
      <TxnDetail
        d={detail}
        {categories}
        mode="sheet"
        compact={detent === 'medium'}
        onclose={back}
        onexpand={() => (detent = 'large')}
        {reload}
      />
    {/if}
  </Sheet>
{/if}

{#if addingCash}<AddExpense account={a.id} onclose={() => (addingCash = false)} />{/if}

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 28px;
    min-width: 0;
  }

  .acct {
    display: flex;
    flex-direction: column;
    gap: 20px;
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
    margin: 0;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--ink-3);
    font: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .id {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .aname {
    font-size: 20px;
    font-weight: 500;
    color: var(--ink);
  }

  .abig {
    font-size: 40px;
    font-weight: 500;
    line-height: 1.1;
    letter-spacing: var(--ls-hero);
  }

  .unit {
    font-size: 20px;
    font-weight: 400;
    letter-spacing: 0;
    color: var(--ink-2);
  }

  .avail {
    font-size: 15px;
    color: var(--ink-2);
  }

  .avail :global(.figure) {
    color: var(--ink-2);
  }

  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .pair > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 22px;
  }

  .k {
    font-size: 13px;
    color: var(--ink-3);
  }

  .pair :global(.in) {
    color: var(--money-in-text);
  }

  .day {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 14px 16px 4px 27px;
  }

  .day:not(:first-child) {
    border-top: 1px solid var(--line);
  }

  /* The day's label already separates it from the day before. */
  .day + :global(.cq) {
    border-top: 0;
  }

  .dl {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-3);
  }

  .dt {
    font-size: 13px;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }

  .none {
    margin: 0;
    padding: 18px 20px;
    font-size: 15px;
    color: var(--ink-2);
  }

  .add {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    min-height: 48px;
    margin: 0;
    padding: 0 18px;
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    background: none;
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    color: var(--accent-text);
    text-align: left;
    cursor: pointer;
  }

  .back {
    align-self: flex-start;
    min-height: 0;
    margin: 0 0 -18px;
    padding: 0 4px;
    border: 0;
    background: none;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    color: var(--accent-text);
    cursor: pointer;
  }

  .back:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
