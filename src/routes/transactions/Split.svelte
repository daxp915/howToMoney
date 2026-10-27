<script lang="ts">
  import Btn from '$lib/components/ui/Btn.svelte';
  import CategoryPill from '$lib/components/ui/CategoryPill.svelte';
  import { usd } from '$lib/money';
  import Picker from './Picker.svelte';

  /**
   * Split: one receipt, several categories. Dollars, not percents.
   * The bar and "Left to split" show the gap as you type, and the button says
   * exactly what is missing ("Split $129.36 of $141.36", "Pick a category for
   * part 3") rather than an error after the fact. Saving is reversible from
   * the toast, so there is no confirmation.
   */
  type Cat = { id: string; name: string; icon: string | null };
  let {
    merchant,
    dateLabel,
    total,
    categories,
    initial,
    onback,
    onsave,
    backLabel = 'Back'
  }: {
    merchant: string;
    dateLabel: string;
    /** Positive. */
    total: number;
    categories: Cat[];
    initial: { categoryId: string | null; amount: number }[];
    onback: () => void;
    onsave: (parts: { categoryId: string; amount: number }[]) => Promise<void>;
    backLabel?: string;
  } = $props();

  type Part = { categoryId: string | null; amount: string };
  // svelte-ignore state_referenced_locally
  let parts = $state<Part[]>(
    initial.length >= 2
      ? initial.map((p) => ({ categoryId: p.categoryId, amount: p.amount.toFixed(2) }))
      : [
          { categoryId: initial[0]?.categoryId ?? null, amount: total.toFixed(2) },
          { categoryId: null, amount: '' }
        ]
  );
  let picking = $state<number | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);

  const cents = (s: string) => {
    const n = Number(String(s).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  };
  const totalC = $derived(Math.round(total * 100));
  const sumC = $derived(parts.reduce((s, p) => s + cents(p.amount), 0));
  const leftC = $derived(totalC - sumC);
  const catOf = (id: string | null) => categories.find((c) => c.id === id) ?? null;

  const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
  const color = (i: number) => SERIES[i % SERIES.length];

  const blocker = $derived.by(() => {
    if (leftC !== 0) return `Split ${usd(Math.max(sumC, 0) / 100)} of ${usd(total)}`;
    const noCat = parts.findIndex((p) => !p.categoryId);
    if (noCat >= 0) return `Pick a category for part ${noCat + 1}`;
    const noAmt = parts.findIndex((p) => cents(p.amount) === 0);
    if (noAmt >= 0) return `Enter an amount for part ${noAmt + 1}`;
    return null;
  });

  function evenly() {
    const n = parts.length;
    const base = Math.floor(totalC / n);
    parts = parts.map((p, i) => ({ ...p, amount: ((base + (i < totalC - base * n ? 1 : 0)) / 100).toFixed(2) }));
  }

  function add(amountC = 0) {
    parts = [...parts, { categoryId: null, amount: amountC ? (amountC / 100).toFixed(2) : '' }];
  }

  function remove(i: number) {
    if (parts.length <= 2) {
      parts[i] = { categoryId: null, amount: '' };
      return;
    }
    parts = parts.filter((_, k) => k !== i);
  }

  async function save() {
    if (blocker || saving) return;
    saving = true;
    error = null;
    try {
      await onsave(parts.map((p) => ({ categoryId: p.categoryId!, amount: cents(p.amount) / 100 })));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

{#if picking !== null}
  <Picker
    {categories}
    current={parts[picking].categoryId}
    {merchant}
    pastCount={0}
    showAlways={false}
    onback={() => (picking = null)}
    ondone={(id) => {
      if (picking !== null) parts[picking].categoryId = id;
      picking = null;
    }}
  />
{:else}
  <div class="split">
    <div class="bar3">
      <button type="button" class="link" onclick={onback}>‹ {backLabel}</button>
      <span class="title">Split</span>
      <button type="button" class="link right" onclick={evenly}>Evenly</button>
    </div>

    <div class="head">
      <span class="meta">{merchant} · {dateLabel}</span>
      <span class="total figure"><span class="amt">{usd(total)}</span></span>
    </div>

    <div class="stack" aria-hidden="true">
      {#each parts as p, i (i)}
        {#if cents(p.amount) > 0}
          <span style="flex: {cents(p.amount)} 0 0; background: {color(i)}"></span>
        {/if}
      {/each}
      {#if leftC > 0}<span class="rest" style="flex: {leftC} 0 0"></span>{/if}
    </div>

    <div class="parts">
      {#each parts as p, i (i)}
        {@const c = catOf(p.categoryId)}
        <div class="part">
          <span class="sw" style="background: {color(i)}"></span>
          <span class="pick">
            <CategoryPill name={c?.name} icon={c?.icon} chevron={!!c} onclick={() => (picking = i)} />
          </span>
          <input
            class="amount"
            inputmode="decimal"
            aria-label="Amount for part {i + 1}"
            placeholder="0.00"
            bind:value={p.amount}
            onblur={() => {
              if (cents(p.amount)) p.amount = (cents(p.amount) / 100).toFixed(2);
            }}
          />
          <button type="button" class="x" aria-label="Remove part {i + 1}" onclick={() => remove(i)}>×</button>
        </div>
      {/each}
    </div>

    <div class="add-row">
      <button type="button" class="link" onclick={() => add()}>+ Add a part</button>
      {#if leftC > 0}
        <button type="button" class="chip" onclick={() => add(leftC)}>Put {usd(leftC / 100)} in a new part</button>
      {:else}
        <span class="hint">Tab moves between fields</span>
      {/if}
    </div>

    <div class="left" class:gap={leftC !== 0}>
      <span>Left to split</span>
      <span class="figure"><span class="amt">{usd(leftC / 100)}</span></span>
    </div>

    {#if error}<p class="err">{error}</p>{/if}

    <div class="foot">
      <Btn variant="secondary" onclick={onback}>Cancel</Btn>
      <Btn variant="primary" disabled={!!blocker || saving} onclick={save}>
        {blocker ?? `Split into ${parts.length}`}
      </Btn>
    </div>
  </div>
{/if}

<style>
  .split {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 100%;
  }

  .bar3 {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
  }

  .link {
    justify-self: start;
    min-height: 0;
    padding: 4px 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
  }

  .link:hover {
    background: none;
    text-decoration: underline;
  }

  .right {
    justify-self: end;
  }

  .title {
    font-size: 17px;
    font-weight: 500;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .meta {
    font-size: 14px;
    color: var(--ink-2);
  }

  .total {
    font-size: 36px;
    letter-spacing: var(--ls-hero);
  }

  .stack {
    display: flex;
    gap: 3px;
    height: 10px;
  }

  .stack span {
    border-radius: 3px;
  }

  .rest {
    border: 1.5px dashed var(--accent);
    background: transparent !important;
  }

  .parts {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
  }

  .part {
    display: grid;
    grid-template-columns: 10px minmax(0, 1fr) 120px 24px;
    gap: 12px;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }

  .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }

  .pick {
    min-width: 0;
    display: flex;
  }

  .amount {
    min-height: 0;
    width: 100%;
    padding: 12px 14px;
    border: 1px solid transparent;
    border-radius: var(--r-input-amount);
    background: var(--field);
    font-size: 17px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .amount:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
    outline: none;
  }

  .x {
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-3);
    font-size: 18px;
    cursor: pointer;
  }

  .x:hover {
    background: none;
    color: var(--ink);
  }

  .add-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .chip {
    min-height: 0;
    padding: 7px 12px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--accent-soft);
    color: var(--accent-text);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }

  .chip:hover {
    background: var(--accent-soft);
    filter: brightness(0.97);
  }

  .hint {
    font-size: 13px;
    color: var(--ink-3);
  }

  .left {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    border-radius: var(--r-field);
    background: var(--pill);
    border: 1px dashed transparent;
    font-size: 14px;
    color: var(--ink-2);
  }

  .left .figure {
    color: var(--ink);
    font-size: 15px;
  }

  .left.gap {
    background: transparent;
    border-color: var(--accent);
  }

  .left.gap .figure {
    color: var(--accent-text);
  }

  .err {
    margin: 0;
    font-size: 14px;
    color: var(--over-text);
  }

  .foot {
    margin-top: auto;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px;
  }
</style>
