<script lang="ts">
  import type { Snippet } from 'svelte';
  import { budgetState } from '$lib/envelopes';
  import Money from './Money.svelte';
  import Tag from './Tag.svelte';

  /**
   * spent | bar | budget, the v2 category row.
   *
   * Wide (a card 520px+): one line, `28px 1fr 76-92px 132-200px 60-72px`.
   * Narrow (Home's rail, a phone): the name and any tag on line one, then
   * `56-64px 1fr 48-60px` on line two. A container query picks, so the same
   * row is right in a 400px rail on a 1440 screen and on a 402 phone.
   *
   * `budget` renders the right-hand cell instead of the plain amount -- Plan
   * puts its inline editor there.
   */
  let {
    icon,
    name,
    spent,
    budgetAmount,
    href,
    bill = false,
    selected = false,
    onclick,
    budget
  }: {
    icon?: string | null;
    name: string;
    spent: number;
    budgetAmount: number;
    href?: string | null;
    bill?: boolean;
    selected?: boolean;
    onclick?: () => void;
    budget?: Snippet;
  } = $props();

  const st = $derived(budgetState(spent, budgetAmount, bill));
</script>

{#snippet tag()}
  {#if st.paid}<span class="check" aria-label="Paid">✓</span>
  {:else if st.status === 'watch'}<Tag tone="watch" size="sm">Watch</Tag>
  {:else if st.status === 'over'}<Tag tone="over" size="sm"><Money value={st.overBy} cents={false} /> over</Tag>{/if}
{/snippet}

{#snippet bar()}
  <span class="bar" aria-hidden="true"
    ><span class="fill {st.status}" style="width: {Math.round(st.fill * 100)}%"></span></span
  >
{/snippet}

{#snippet right()}
  <span class="right"
    >{#if budget}{@render budget()}{:else}<span class="budget"
        ><span class="amt">{budgetAmount > 0 ? '$' + Math.round(budgetAmount).toLocaleString('en-US') : '—'}</span
        ></span
      >{/if}</span
  >
{/snippet}

<div class="cq">
  <svelte:element
    this={onclick ? 'button' : 'div'}
    class="crow"
    class:selected
    class:clickable={!!onclick}
    type={onclick ? 'button' : undefined}
    {onclick}
    role={onclick ? undefined : 'group'}
  >
    <span class="ico" aria-hidden="true">{icon ?? '•'}</span>
    <span class="name"
      ><span class="ico-n" aria-hidden="true">{icon ?? '•'}</span><span class="nm">{name}</span><span class="tag-in"
        >{@render tag()}</span
      ></span
    >
    <span class="tagcell">{@render tag()}</span>
    <span class="spent"><Money value={spent} cents={false} href={onclick ? undefined : href} /></span>
    {@render bar()}
    {@render right()}
  </svelte:element>
</div>

<style>
  .cq {
    container-type: inline-size;
    border-top: 1px solid var(--line);
  }

  .cq:first-child {
    border-top: 0;
  }

  .crow {
    /* narrow by default */
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) 48px;
    grid-template-areas:
      'name name name'
      'spent bar budget';
    row-gap: 10px;
    column-gap: 12px;
    align-items: center;
    width: 100%;
    min-height: 0;
    margin: 0;
    padding: 14px 18px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    line-height: normal;
  }

  .clickable {
    cursor: pointer;
  }

  .clickable:hover {
    background: var(--pill);
  }

  .clickable:active {
    transform: none;
  }

  .selected,
  .selected:hover {
    background: var(--selected-row);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .ico {
    display: none;
    font-size: 18px;
    text-align: center;
  }

  .name {
    grid-area: name;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    font-size: 16px;
  }

  .ico-n {
    font-size: 17px;
    flex: 0 0 auto;
  }

  .nm {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spent {
    grid-area: spent;
    font-size: 15px;
  }

  .bar {
    grid-area: bar;
    position: relative;
    height: var(--bar-h);
    border-radius: 3px;
    background: var(--track);
    overflow: hidden;
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 3px;
    background: var(--ok);
  }

  .fill.watch {
    background: var(--watch);
  }

  .fill.over {
    background: var(--over);
  }

  .fill.none {
    background: transparent;
  }

  .tagcell {
    display: none;
    grid-area: tag;
    justify-self: end;
  }

  .tag-in {
    display: contents;
  }

  .right {
    grid-area: budget;
    min-width: 0;
  }

  .budget {
    display: block;
    font-size: 15px;
    color: var(--ink-3);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .check {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--ok);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
  }

  @container (min-width: 520px) {
    .crow {
      grid-template-columns: 28px minmax(0, 1fr) 76px minmax(0, 132px) 60px;
      grid-template-areas: 'ico name spent bar budget';
      column-gap: 14px;
    }
    .ico {
      display: block;
      grid-area: ico;
    }
    .ico-n {
      display: none;
    }
    .spent {
      font-size: 16px;
      text-align: right;
    }
    .budget {
      text-align: left;
    }
  }

  /* Wide enough for its own tag column (Plan): tags line up. */
  @container (min-width: 700px) {
    .crow {
      grid-template-columns: 28px minmax(0, 1fr) 92px 84px minmax(120px, 200px) 72px;
      grid-template-areas: 'ico name tag spent bar budget';
      padding: 14px 20px;
    }
    .tagcell {
      display: block;
    }
    .tag-in {
      display: none;
    }
  }
</style>
