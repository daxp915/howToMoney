<script lang="ts">
  import AskButton from '$lib/components/ui/AskButton.svelte';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import CategoryRow from '$lib/components/ui/CategoryRow.svelte';
  import Money from '$lib/components/ui/Money.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import { drillHref } from '$lib/drill';
  import { usd } from '$lib/money';
  import BudgetEdit from './BudgetEdit.svelte';
  import Calendar from './Calendar.svelte';
  import Goals from './Goals.svelte';
  import SeriesActions from './SeriesActions.svelte';
  import AddBill from './AddBill.svelte';
  import { enhance } from '$app/forms';
  import { toast } from '$lib/toast.svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import { phone } from '$lib/media.svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PlanEvent } from '$lib/server/plan';

  let { data, form } = $props();

  // The recurring row whose actions are open: a sheet on a phone, under the
  // row on desktop.
  let acting = $state<{ key: string; event: PlanEvent & { series: NonNullable<PlanEvent['series']> } } | null>(null);

  // "Add a recurring bill": inline under Next up on desktop, a sheet on a phone.
  let adding = $state(false);
  const billCategories = (m: NonNullable<typeof data.month>) => {
    const seen = new Set<string>();
    return [...m.plan.bills, ...m.plan.everyday, ...m.plan.unbudgeted]
      .filter((c) => !seen.has(c.id) && seen.add(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  // A calendar day picked to see exactly what is on it; null shows Next up.
  let day = $state<string | null>(null);
  function pick(d: string) {
    day = day === d ? null : d;
    acting = null;
  }
  const dayLabel = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const SEGMENTS = [
    { key: 'envelopes', label: 'Envelopes', href: '/plan' },
    { key: 'recurring', label: 'Recurring', href: '/plan?tab=recurring' },
    { key: 'goals', label: 'Goals', href: '/plan?tab=goals' }
  ];

  const whole = (v: number) => usd(v, { cents: false });
  const sum = (xs: { budget: number }[]) => xs.reduce((s, x) => s + x.budget, 0);
  const spent = (xs: { spent: number; budget: number }[], capped = false) =>
    xs.reduce((s, x) => s + (capped ? Math.min(x.spent, x.budget) : x.spent), 0);

  function when(e: { date: string; paid: boolean; predicted?: string; late?: boolean }, today: string): string {
    const d = new Date(e.date + 'T12:00:00');
    const short = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (e.paid) return `Paid ${short}`;
    if (e.late) return 'Late · expected tomorrow';
    const tomorrow = new Date(new Date(today + 'T12:00:00').getTime() + 864e5).toLocaleDateString('en-CA');
    const day = e.date === today ? 'Today' : e.date === tomorrow ? 'Tomorrow' : short;
    return e.predicted ? `${day} · predicted` : day;
  }
</script>

<svelte:head><title>Plan · HTMFD</title></svelte:head>

{#if phone.current}
  <Sheet open={!!acting} onclose={() => (acting = null)} label="Recurring charge">
    {#if acting}<SeriesActions event={acting.event} onclose={() => (acting = null)} />{/if}
  </Sheet>
  {#if data.month}
    <Sheet open={adding} detent="large" onclose={() => (adding = false)} label="Add a recurring bill">
      {#if adding}<AddBill categories={billCategories(data.month)} today={data.month.today} onclose={() => (adding = false)} />{/if}
    </Sheet>
  {/if}
{/if}

{#snippet missedList(m: NonNullable<typeof data.month>)}
  {#if m.missed.length}
    <!-- A recurring charge that didn't come when it should have
         ($lib/recurringState). It stays in the forecasts until a second
         cycle is missed; "It stopped" ends it now. -->
    <Section label="May have stopped">
      <Card>
        {#each m.missed as x (x.id)}
          <div class="missed">
            <span class="emoji" aria-hidden="true">{x.emoji}</span>
            <a class="who" href={x.href}
              ><span class="nm">{x.name}</span><span class="when"
                >Expected {dayLabel(x.expected)} · <span class="figure"><span class="amt">{usd(x.usual)}</span></span> hasn't come</span
              ></a
            >
            <form
              method="POST"
              action="?/endSeries"
              use:enhance={() => {
                const { id, name } = x;
                return async ({ update }) => {
                  await update();
                  toast.show(`${name} stopped · off the calendar and forecasts`, async () => {
                    const body = new FormData();
                    body.set('id', id);
                    body.set('status', 'active');
                    await fetch('?/setStatus', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
                    await invalidateAll();
                  });
                };
              }}
            >
              <input type="hidden" name="id" value={x.id} />
              <Btn variant="secondary" size="sm" type="submit">It stopped</Btn>
            </form>
          </div>
        {/each}
      </Card>
    </Section>
  {/if}
{/snippet}

{#snippet addBill(m: NonNullable<typeof data.month>)}
  {#if adding && !phone.current}
    <Card pad="body"><AddBill categories={billCategories(m)} today={m.today} onclose={() => (adding = false)} /></Card>
  {:else}
    <div class="add-bill"><Btn variant="secondary" full onclick={() => (adding = true)}>+ Add a recurring bill</Btn></div>
  {/if}
{/snippet}

{#snippet calendar(m: NonNullable<typeof data.month>)}
  <Section label={m.plan.label}>
    <Card>
      <Calendar
        wide={!phone.current}
        from={m.plan.from}
        label={m.plan.label}
        today={m.today}
        events={m.events}
        out={m.calendar.out}
        income={m.calendar.in}
        outHref={drillHref({ from: m.plan.from, to: m.plan.to, flow: 'out' })}
        inHref={m.plan.income.href}
        selected={day}
        onpick={pick}
      />
    </Card>
  </Section>
{/snippet}

{#snippet upNext(m: NonNullable<typeof data.month>, rail: boolean)}
  {@const list = day ? m.events.filter((e) => e.date === day) : m.calendar.next}
  {#if list.length}
    <Section label={day ? dayLabel(day) : 'Next up'}>
      {#snippet aside()}
        {#if day}<button type="button" class="back-next" onclick={() => ((day = null), (acting = null))}>Next up ›</button>
        {:else if rail}<a class="back-next" href="/plan?tab=recurring">Calendar ›</a>{/if}
      {/snippet}
      <Card>
        {#each list as e, i (e.date + e.name + i)}
          {#snippet row()}
            <span class="emoji" aria-hidden="true">{e.emoji}</span>
            <span class="who" title={e.predicted}
              ><span class="nm">{e.name}</span><span class="when">{when(e, m.today)}</span
              >{#if e.predicted && (e.kind === 'pay' || day)}<span class="basis">{e.predicted}</span>{/if}</span
            >
            <span class="amt-cell">
              <span class="figure" class:in={e.amount > 0}
                ><span class="amt">{e.estimate && !e.paid ? '~' : ''}{usd(e.amount, { abs: e.amount < 0, plus: e.amount > 0 })}</span
                ></span
              >
              {#if e.paid && e.amount < 0}<span class="chk" aria-label="Paid">✓</span>{/if}
            </span>
          {/snippet}
          {#if e.series}
            {@const key = e.date + e.name}
            <!-- : a recurring row opens its actions. -->
            <button
              type="button"
              class="next"
              aria-expanded={acting?.key === key}
              onclick={() => (acting = acting?.key === key ? null : { key, event: { ...e, series: e.series! } })}>{@render row()}</button
            >
            {#if !phone.current && acting?.key === key}
              <div class="inline-acts"><SeriesActions event={acting.event} onclose={() => (acting = null)} /></div>
            {/if}
          {:else}
            <a class="next" href={e.href}>{@render row()}</a>
          {/if}
        {/each}
      </Card>
    </Section>
  {/if}
{/snippet}

{#snippet envelopes(m: NonNullable<typeof data.month>)}
  {@const p = m.plan}
  {@const bills = sum(p.bills)}
  {@const everyday = sum(p.everyday)}
  {@const savings = sum(p.savings)}
  {@const left = Math.max(p.toAssign, 0)}
  <Card pad="body" class="assign-card">
    <div class="assign-top">
      <div class="assign-copy">
        <div class="big">
          {#if p.toAssign >= 0}
            <Money value={p.toAssign} cents={false} href={p.income.href} /> <span class="unit">to assign</span>
          {:else}
            <Money value={-p.toAssign} cents={false} href={p.income.href} /> <span class="unit">over-assigned</span>
          {/if}
        </div>
        <div class="sub">
          of <Money value={p.income.expected} cents={false} href={p.income.href} /> expected in {p.label}
        </div>
      </div>
      {#if p.budgeted === 0}
        <!-- : no budget yet -- the hero keeps its shape. -->
      {:else if p.toAssign > 0}
        <!-- : nothing stores an assignment yet, so this asks. -->
        <span class="assign-btn"><AskButton before="What should I do with " amount={p.toAssign} after="?" /></span>
      {/if}
    </div>
    <div class="stack" aria-hidden="true">
      {#if bills}<span style="flex: {bills} 1 0; background: var(--series-1)"></span>{/if}
      {#if everyday}<span style="flex: {everyday} 1 0; background: var(--series-2)"></span>{/if}
      {#if savings}<span style="flex: {savings} 1 0; background: var(--series-3)"></span>{/if}
      {#if left}<span class="rest" style="flex: {left} 1 0"></span>{/if}
    </div>
    <div class="legend">
      <span><i style="background: var(--series-1)"></i>Bills <Money value={bills} cents={false} /></span>
      <span><i style="background: var(--series-2)"></i>Everyday <Money value={everyday} cents={false} /></span>
      <span><i style="background: var(--series-3)"></i>Savings <Money value={savings} cents={false} /></span>
    </div>
    {#if p.budgeted === 0 && p.income.expected === 0}
      <!-- Nothing to propose from yet: the builder reads past months. -->
      <p class="none-yet">
        Once a few weeks of spending have synced, the app can propose a budget from them. You can also set one
        category at a time below.
      </p>
    {:else if p.budgeted === 0}
      <p class="none-yet">Typical monthly income, none of it assigned yet.</p>
      <div class="assign-empty"><Btn variant="primary" full href="/welcome?step=4">Build a budget from history</Btn></div>
    {:else if p.toAssign > 0}
      <div class="assign-phone">
        <AskButton before="What should I do with " amount={p.toAssign} after="?" full />
      </div>
    {/if}
  </Card>

  {#if p.bills.length}
    <Section label="Bills" note="{whole(spent(p.bills, true))} of {whole(bills)} paid">
      <Card>
        {#each p.bills as c (c.id)}
          <CategoryRow icon={c.icon} name={c.name} spent={c.spent} budgetAmount={c.budget} href={c.href} bill>
            {#snippet budget()}<BudgetEdit categoryId={c.id} amount={c.budget} suggested={c.suggested} name={c.name} />{/snippet}
          </CategoryRow>
        {/each}
      </Card>
    </Section>
  {/if}

  <Section label="Everyday" note="{whole(spent(p.everyday))} of {whole(everyday)}">
    <Card>
      {#each p.everyday as c (c.id)}
        <CategoryRow icon={c.icon} name={c.name} spent={c.spent} budgetAmount={c.budget} href={c.href}>
          {#snippet budget()}<BudgetEdit categoryId={c.id} amount={c.budget} name={c.name} />{/snippet}
        </CategoryRow>
      {/each}
      {#if p.unbudgeted.filter((c) => !c.bill).length}
        <details class="more">
          <summary>+ Budget another category</summary>
          {#each p.unbudgeted.filter((c) => !c.bill) as c (c.id)}
            <CategoryRow icon={c.icon} name={c.name} spent={c.spent} budgetAmount={0} href={c.href}>
              {#snippet budget()}<BudgetEdit categoryId={c.id} amount={0} name={c.name} />{/snippet}
            </CategoryRow>
          {/each}
        </details>
      {/if}
    </Card>
  </Section>

  {#if p.savings.length}
    <Section label="Savings" note="{whole(spent(p.savings, true))} of {whole(savings)}">
      <Card>
        {#each p.savings as g (g.id)}
          <CategoryRow icon="🎯" name={g.name} spent={g.spent} budgetAmount={g.budget} href={g.href} bill />
        {/each}
      </Card>
    </Section>
  {/if}
{/snippet}

<div class="plan" class:goals={data.tab === 'goals'}>
  <div class="seg-wrap">
    <SegmentedControl label="Plan" items={SEGMENTS} value={data.tab} />
  </div>

  {#if data.tab === 'goals'}
    <Goals data={data.goals} {form} />
  {:else if data.month}
    <!-- Envelopes is what each category may spend this month; Recurring is
         when the repeating bills and paychecks land. On desktop each keeps a
         short Next up beside it rather than the same two columns twice. -->
    <div class="cols">
      {#if data.tab === 'recurring'}
        <div class="col left">{@render calendar(data.month)}</div>
        <div class="col right">{@render missedList(data.month)}{@render upNext(data.month, false)}{@render addBill(data.month)}</div>
      {:else}
        <div class="col left">{@render envelopes(data.month)}</div>
        <div class="col right phone-hide">{@render upNext(data.month, true)}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .add-bill {
    display: flex;
  }

  .missed {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 13px 18px;
  }

  .missed + .missed {
    border-top: 1px solid var(--line);
  }

  .missed .who {
    color: var(--ink);
  }

  .missed .who:hover .nm {
    text-decoration: underline dotted var(--accent);
    text-underline-offset: 4px;
  }

  .plan {
    display: flex;
    flex-direction: column;
    gap: 28px;
    line-height: normal;
  }

  .seg-wrap {
    max-width: 420px;
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--rail-w);
    gap: 32px;
    align-items: start;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 28px;
    min-width: 0;
  }

  :global(.assign-card) {
    padding: 22px 24px !important;
  }

  .assign-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
  }

  .assign-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .big {
    font-size: 48px;
    font-weight: 500;
    letter-spacing: var(--ls-hero);
    line-height: 1.1;
  }

  .unit {
    font-weight: 400;
    color: var(--ink-2);
  }

  .sub {
    font-size: 15px;
    color: var(--ink-2);
  }

  .sub :global(.figure) {
    color: var(--ink-2);
  }

  .stack {
    display: flex;
    height: 14px;
    gap: 3px;
    margin-top: 20px;
    border-radius: 7px;
    overflow: hidden;
  }

  .rest {
    border: 1.5px dashed var(--accent);
    border-radius: 0 7px 7px 0;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    margin-top: 12px;
    font-size: 13px;
    color: var(--ink-2);
  }

  .legend span {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .legend :global(.figure) {
    color: var(--ink);
  }

  .legend i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }

  .none-yet {
    margin: 12px 0 0;
    font-size: 14px;
    color: var(--ink-2);
  }

  .assign-empty {
    margin-top: 16px;
  }

  .assign-phone {
    display: none;
    margin-top: 20px;
  }

  .more summary {
    padding: 14px 20px;
    border-top: 1px solid var(--line);
    font-size: 15px;
    font-weight: 500;
    color: var(--accent-text);
    cursor: pointer;
    list-style: none;
  }

  .more summary::-webkit-details-marker {
    display: none;
  }

  .next {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 13px 18px;
    border-top: 1px solid var(--line);
    color: var(--ink);
  }

  .next:first-child {
    border-top: 0;
  }

  .next:hover {
    background: var(--pill);
  }

  /* A recurring row is a button (it opens its actions): undo the global
     button rule so it lines up with the link rows. */
  .back-next {
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }

  button.next {
    width: 100%;
    min-height: 0;
    margin: 0;
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  button.next:first-child {
    border-top: 0;
  }

  button.next:hover,
  button.next[aria-expanded='true'] {
    background: var(--pill);
  }

  .inline-acts {
    padding: 14px 16px 16px;
    border-top: 1px solid var(--line);
  }

  .emoji {
    font-size: 18px;
  }

  .who {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .nm {
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .when {
    font-size: 13px;
    color: var(--ink-3);
  }

  /* Why a predicted date is that date; paychecks always, bills on a picked day. */
  .basis {
    font-size: 12px;
    color: var(--ink-3);
    white-space: normal;
  }

  .amt-cell {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
  }

  .figure.in {
    color: var(--money-in-text);
  }

  .chk {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--ok);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
  }

  @media (max-width: 1100px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 760px) {
    .plan,
    .col {
      gap: 24px;
    }

    .seg-wrap {
      max-width: none;
    }

    .phone-hide {
      display: none;
    }

    .big {
      font-size: 36px;
    }

    .assign-top :global(.assign-btn) {
      display: none;
    }

    .assign-phone {
      display: block;
    }
  }
</style>
