<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import Rich from '$lib/components/advisor/Rich.svelte';
  import PaceChart from '$lib/components/PaceChart.svelte';
  import AskButton from '$lib/components/ui/AskButton.svelte';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import CategoryRow from '$lib/components/ui/CategoryRow.svelte';
  import Money from '$lib/components/ui/Money.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import Toggle from '$lib/components/ui/Toggle.svelte';
  import TransactionRow from '$lib/components/ui/TransactionRow.svelte';
  import Tip from '$lib/components/ui/Tip.svelte';
  import { tips } from '$lib/tips.svelte';
  import { page } from '$app/state';
  import { drillHref } from '$lib/drill';
  import { usd } from '$lib/money';
  import { phone } from '$lib/media.svelte';
  import { HOME_CARDS } from '$lib/preferences';
  import { toast } from '$lib/toast.svelte';

  let { data } = $props();
  let pmfDone = $state(false);

  const left = $derived(data.empty ? 0 : data.budgeted - data.spent);
  const shortDay = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  let marking = $state(false);

  // First look: two tips on Home, with Skip.
  const seen = (id: string) => tips.dismissed(id, page.data.preferences?.dismissedTips);
  const skip = () => ['home-number', 'home-review', 'pace-bills'].forEach((id) => tips.dismiss(id));

  // ---- which cards are on ---------------------------------------------------
  // Held here so a switch answers at once; the save, and the reload that fills
  // a newly switched-on card in, follow behind it.
  // While a save is in flight, a reload from an earlier one must not put back
  // the list from before it -- flipping three switches quickly lost the last.
  let chosen = $state<string[]>([]);
  let saving = 0;
  $effect.pre(() => {
    if (!data.empty && saving === 0) chosen = [...data.cards];
  });
  const has = (id: string) => chosen.includes(id);
  const advisorOn = $derived(!page.data.preferences?.hiddenTabs?.includes('/advisor'));
  const offered = $derived(HOME_CARDS.filter((c) => c.id !== 'finding' || advisorOn));
  // Tiles actually drawn: net worth and in-and-out need their data as well.
  const shownGlances = $derived(
    [has('payday'), has('worth') && !!data.worth, has('flow') && !!data.flow, has('repeating')].filter(Boolean).length
  );
  let editing = $state(false);

  async function saveCards(next: string[]) {
    const before = chosen;
    chosen = next;
    saving++;
    let ok = false;
    try {
      const r = await fetch('/api/preferences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ on: next })
      });
      ok = r.ok;
    } catch {
      // ok stays false
    }
    saving--;
    if (!ok) {
      chosen = before;
      toast.show("Couldn't save that. Try again.");
      return;
    }
    await invalidateAll();
  }
  const setCard = (id: string, on: boolean) =>
    saveCards(on ? [...chosen, id] : chosen.filter((c) => c !== id));

  const longDay = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const inDays = (n: number) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
  const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const ordinal = (n: number) => {
    const t = n % 100;
    return `${n}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
  };
</script>

<svelte:head><title>Home · HTMFD</title></svelte:head>

{#if data.empty}
  <!-- : the hero keeps its shape with no bank yet. -->
  <div class="home">
    <div class="col">
      <Section label="This month">
        <Card pad="hero">
          <div class="hero-copy">
            <div class="hero-fig"><span class="faint">$—</span> <span class="unit">left</span></div>
            <p class="empty-line">Connect a bank and this fills in within about a minute.</p>
          </div>
          <div class="empty-actions">
            <Btn variant="primary" full href="/settings/connections">Connect a bank</Btn>
            <a class="text-link" href="/settings/import">Import a file</a>
          </div>
        </Card>
      </Section>
    </div>
  </div>
{:else}
  <div class="home">
    <div class="col main-col">
      <Section label="{data.month.label} · Day {data.month.day} of {data.month.days}">
        <Card pad="hero">
          <div class="hero-copy">
            {#if data.budgeted > 0}
              <div class="hero-fig">
                <Money value={Math.abs(left)} cents={false} href={data.spentHref} />
                <span class="unit">{left < 0 ? 'over' : 'left'}</span>
              </div>
              <div class="sub">
                out of <Money value={data.budgeted} cents={false} href="/plan" /> budgeted
              </div>
            {:else}
              <div class="hero-fig">
                <Money value={data.spent} cents={false} href={data.spentHref} />
                <span class="unit">spent</span>
              </div>
              <div class="sub">No budget yet. <a class="text-link" href="/plan">Build one in Plan</a></div>
            {/if}
          </div>
          <Tip
            id="home-number"
            title="This is your number"
            step="1 of 2"
            floating
            style="left: 50%; transform: translateX(-50%); top: calc(100% - 40px)"
            next={() => tips.dismiss('home-number')}
            onskip={skip}
            when={data.budgeted > 0}
          >
            What's left of this month's budget. Stay under the dotted line and you'll finish the month under budget.
          </Tip>
          {#if data.budgeted > 0}
            <PaceChart
              actual={data.pace.actual}
              last={data.pace.last}
              lastLabel={data.pace.lastLabel}
              expected={data.pace.expected}
              under={data.pace.under}
              monthShort={data.month.short}
              days={data.month.days}
              hasBills={data.hasBills}
              underHref={data.spentHref}
              tipReady={seen('home-review')}
            />
          {/if}
        </Card>
      </Section>

      {#if data.askPmf && !pmfDone}
        <!-- The beta's day-30 question (admin › Beta reads the answers). Asked
             once; "Not now" records 'skipped' so it never comes back. -->
        <Card pad="body">
          <form
            class="pmf"
            method="POST"
            action="?/pmf"
            use:enhance={() => {
              pmfDone = true;
              return async () => {};
            }}
          >
            <p class="pmf-q">Quick question: if you could no longer use HTMFD, how would you feel?</p>
            <div class="pmf-a">
              <button class="pmf-b" name="answer" value="very">Very disappointed</button>
              <button class="pmf-b" name="answer" value="somewhat">Somewhat disappointed</button>
              <button class="pmf-b" name="answer" value="not">Not disappointed</button>
            </div>
            <button class="pmf-skip" name="answer" value="skipped">Not now</button>
          </form>
        </Card>
      {/if}

      {#if shownGlances}
        <!-- : one label above one card. Each tile is a link to the page
             that owns it (the caption's ::after covers the cell); only sums of
             transactions are figure links, raised above it as siblings. On a
             phone the card becomes rows, with the shorter copy marked .n
             (the tile copy is .w). -->
        <Section label="At a glance">
          <div class="glance-wrap">
            <div class="glance-card n{shownGlances}">
              {#if has('payday')}
                <article class="glance">
                  {@render caption('Next payday', '/plan?tab=recurring')}
                  {#if data.payday}
                    {@const p = data.payday}
                    <div class="g-fig">{longDay(p.date)}</div>
                    <div class="g-ctx">
                      <div class="g-sub w">{cap(inDays(p.days))} · <Money value={p.amount} cents={false} /> expected</div>
                      <div class="g-sub w">
                        {#if p.dueCount}<Money value={p.due} cents={false} /> in {plural(p.dueCount, 'bill')} due before it
                        {:else}No bills due before it{/if}
                      </div>
                      <div class="g-sub n">
                        {cap(inDays(p.days))} · {#if p.dueCount}<Money value={p.due} cents={false} /> in {plural(p.dueCount, 'bill')} first{:else}no bills first{/if}
                      </div>
                    </div>
                  {:else}
                    <div class="g-fig faint">Not yet</div>
                    <div class="g-ctx">
                      <div class="g-sub w">Shows once a couple of paychecks have landed.</div>
                      <div class="g-sub n">Shows once a couple of paychecks land</div>
                    </div>
                  {/if}
                </article>
              {/if}
              {#if has('worth') && data.worth}
                {@const w = data.worth}
                <article class="glance">
                  {@render caption('Net worth', '/wealth')}
                  <div class="g-fig"><Money value={w.value} cents={false} /></div>
                  <div class="g-ctx">
                    <div class="g-sub">
                      <span aria-hidden="true">{w.change < 0 ? '↓' : '↑'}</span><span class="sr">{w.change < 0 ? 'Down' : 'Up'}</span>
                      <Money value={Math.abs(w.change)} cents={false} /> since {shortDay(w.since)}
                    </div>
                  </div>
                </article>
              {/if}
              {#if has('flow') && data.flow}
                {@const f = data.flow}
                {@const net = f.income - f.spent}
                <article class="glance">
                  {@render caption('In and out', f.monthHref)}
                  {#if f.payDay}
                    <!-- Before the month's first paycheck every month reads "short". -->
                    <div class="g-fig">
                      <Money value={f.spent} cents={false} href={f.spentHref} /> <span class="unit w">out so far</span><span class="unit n">out</span>
                    </div>
                    <div class="g-ctx">
                      <div class="g-sub w">
                        {#if f.income > 0}<Money value={f.income} cents={false} href={f.incomeHref} /> in so far.{:else}Nothing in yet.{/if}
                        Pay usually lands on the {ordinal(f.payDay)}.
                      </div>
                      <div class="g-sub n">
                        {#if f.income > 0}<Money value={f.income} cents={false} href={f.incomeHref} /> in so far{:else}Nothing in yet{/if}
                        · pay usually lands on the {ordinal(f.payDay)}
                      </div>
                    </div>
                  {:else}
                    <!-- The net is not a link: no list of rows sums to it. -->
                    <div class="g-fig"><Money value={Math.abs(net)} cents={false} /> <span class="unit">{net < 0 ? 'short' : 'ahead'}</span></div>
                    <div class="g-ctx">
                      <div class="g-sub">
                        <span class="dot in" aria-hidden="true"></span><Money value={f.income} cents={false} href={f.incomeHref} class="in-fig" /> in
                        · <span class="dot out" aria-hidden="true"></span><Money value={f.spent} cents={false} href={f.spentHref} /> out
                      </div>
                    </div>
                  {/if}
                </article>
              {/if}
              {#if has('repeating')}
                <article class="glance">
                  {@render caption('Recurring cost', '/plan?tab=recurring')}
                  {#if data.repeating}
                    {@const r = data.repeating}
                    <div class="g-fig"><Money value={r.monthly} cents={false} /> <span class="unit">/ mo</span></div>
                    <div class="g-ctx">
                      <div class="g-sub">
                        {plural(r.count, 'charge')}{#if r.changed}&nbsp;· <span class="dot watch" aria-hidden="true"></span>{r.changed} changed price{/if}{#if r.missed}&nbsp;· <span
                        class="dot watch"
                        aria-hidden="true"
                      ></span>{r.missed} may have stopped{/if}
                      </div>
                    </div>
                  {:else}
                    <div class="g-fig faint">None yet</div>
                    <div class="g-ctx">
                      <div class="g-sub w">Shows once a charge has repeated two or three times.</div>
                      <div class="g-sub n">Shows once a charge repeats a few times</div>
                    </div>
                  {/if}
                </article>
              {/if}
            </div>
          </div>
        </Section>
      {/if}

      {#if has('kept') && data.kept}
        {@const k = data.kept}
        <!-- : last month, and a question rather than "Add to Savings",
             which would need assignments the app does not store yet. -->
        {@const left = k.budgeted - k.spent}
        <Section label={k.label}>
          <Card pad="body">
            <div class="kept">
              {#if k.budgeted <= 0}
                <div class="kept-fig">You spent <Money value={k.spent} cents={false} href={k.href} /></div>
                <div class="sub">No budget was set for {k.label}.</div>
              {:else if left >= 1}
                <div class="kept-fig">You kept <Money value={left} cents={false} href={k.href} /></div>
                <div class="sub">
                  <Money value={k.spent} cents={false} href={k.href} /> spent of <Money value={k.budgeted} cents={false} /> budgeted
                </div>
                <div class="kept-ask">
                  <AskButton before="Where should the " amount={left} after=" go?" full />
                </div>
              {:else}
                <div class="kept-fig">
                  {#if left > -1}Right on budget{:else}<Money value={-left} cents={false} href={k.href} /> over budget{/if}
                </div>
                <div class="sub">
                  <Money value={k.spent} cents={false} href={k.href} /> spent of <Money value={k.budgeted} cents={false} /> budgeted
                </div>
                {#if left <= -1}
                  <div class="kept-ask">
                    <AskButton before="What pushed {k.label} " amount={-left} after=" over?" full />
                  </div>
                {/if}
              {/if}
            </div>
          </Card>
        </Section>
      {/if}

      {#if has('review') && data.inbox}
      <Section
        label="To review"
        link={{ href: '/transactions?review=1', text: data.inbox.total > data.inbox.rows.length ? `All ${data.inbox.total} ›` : 'All activity ›' }}
      >
        {#if seen('home-number')}
          <Tip id="home-review" title="New transactions land here" step="2 of 2" onskip={skip}>
            Each one gets a dot until you look at it. Fix a category with one tap, then mark them reviewed.
          </Tip>
        {/if}
        {#if data.inbox.rows.length}
          <Card>
            {#each data.inbox.rows as t (t.id)}
              <TransactionRow {t} dot={false} href="/transactions?review=1&select={t.id}" />
            {/each}
            <form
              class="mark"
              method="POST"
              action="?/reviewed"
              use:enhance={() => {
                marking = true;
                return async ({ update }) => {
                  await update();
                  marking = false;
                };
              }}
            >
              {#each data.inbox.rows as t (t.id)}<input type="hidden" name="id" value={t.id} />{/each}
              <Btn variant="soft" full type="submit" disabled={marking}>
                Mark {data.inbox.rows.length} as reviewed
              </Btn>
            </form>
          </Card>
        {:else}
          <Card pad="body">
            <div class="caught">
              <span class="check" aria-hidden="true">✓</span>
              <div>
                <div class="caught-title">All caught up</div>
                <div class="caught-sub">Nothing new to look at.</div>
              </div>
            </div>
          </Card>
        {/if}
      </Section>
      {/if}
      <div class="customize cz-main">{@render customize()}</div>
    </div>

    <div class="col rail">
      {#if has('budgets') && data.budgets.length}
        <Section label="Budgets" link={{ href: '/plan', text: 'Plan ›' }}>
          <Card>
            {#each data.budgets as c (c.id)}
              <CategoryRow icon={c.icon} name={c.name} spent={c.spent} budgetAmount={c.budget} href={c.href} />
            {/each}
          </Card>
        </Section>
      {/if}

      {#if has('upcoming') && (data.upcoming.length || data.missed.length)}
        <Section label="Upcoming · Next 7 days" link={{ href: '/plan?tab=recurring', text: 'Recurring ›' }}>
          <div class="tiles">
            <!-- A recurring charge that didn't come when expected: it may have
                 stopped. Plan › Recurring has "It stopped". -->
            {#each data.missed as m (m.id)}
              <a class="tile" href="/plan?tab=recurring" title="Expected {shortDay(m.expected)} and hasn't come. It may have stopped.">
                <span class="tile-top">
                  <span class="emoji" aria-hidden="true">{m.emoji}</span>
                  <span class="date missed">Missed {shortDay(m.expected)}</span>
                </span>
                <span class="tile-name">{m.name}</span>
                <span class="tile-amt tile-missed">May have stopped</span>
              </a>
            {/each}
            {#each data.upcoming as e, i (e.date + e.name + i)}
              <a class="tile" href={e.href} title={e.predicted}>
                <span class="tile-top">
                  <span class="emoji" aria-hidden="true">{e.emoji}</span>
                  {#if e.paid}<span class="paid" aria-label="Paid">✓</span>
                  {:else}<span class="date" aria-label="Predicted for {shortDay(e.date)}"
                      >{e.predicted ? '~' : ''}{shortDay(e.date)}</span
                    >{/if}
                </span>
                <span class="tile-name">{e.name}</span>
                <span class="tile-amt figure"
                  ><span class="amt">{e.estimate ? '~' : ''}{usd(e.amount, { abs: true })}</span></span
                >
              </a>
            {/each}
          </div>
        </Section>
      {/if}

      {#if has('goals') && data.goals?.rows.length}
        {@const g = data.goals}
        <Section label="Goals" link={{ href: '/plan?tab=goals', text: g.total > g.rows.length ? `All ${g.total} ›` : 'Plan ›' }}>
          <Card>
            {#each g.rows as goal (goal.id)}
              {@const pct = Math.round(goal.progress * 100)}
              <a class="goal" href="/plan?tab=goals">
                <span class="goal-top">
                  <span class="goal-name">{goal.name}</span>
                  <span class="goal-pct">{pct}%</span>
                </span>
                <span class="goal-bar"
                  ><span
                    class="goal-fill"
                    class:ok={goal.onTrack === true}
                    class:watch={goal.onTrack === false}
                    style="width: {pct}%"
                  ></span></span
                >
                <span class="goal-sub">
                  <span class="figure"><span class="amt">{usd(goal.current, { cents: false })}</span></span> of
                  <span class="figure"><span class="amt">{usd(goal.target, { cents: false })}</span></span>{#if goal.onTrack === false}<span
                      class="behind">&nbsp;· Behind</span
                    >{/if}
                </span>
              </a>
            {/each}
          </Card>
        </Section>
      {/if}

      {#if has('places') && data.places?.length}
        <Section label="Top places · {data.month.short}" link={{ href: data.spentHref, text: 'Activity ›' }}>
          <Card>
            {#each data.places as pl (pl.key)}
              <div class="place">
                <span class="place-name">{pl.name}</span>
                <span class="place-n">{pl.count}×</span>
                <Money value={pl.spent} cents={false} href={pl.href} />
              </div>
            {/each}
          </Card>
        </Section>
      {/if}

      {#if has('finding') && data.advisor?.top}
        {@const top = data.advisor.top}
        <Section label="Advisor">
          <Card pad="body">
            <div class="finding">
              <p class="finding-text adv-rich"><Rich text={top.text} figures={top.figures} /></p>
              <a class="text-link" href="/advisor?view=ask&q={encodeURIComponent(top.short)}">Ask a follow-up ›</a>
            </div>
          </Card>
        </Section>
      {/if}
    </div>

    <!-- Below 1100px the rail stacks under the main column, so the way in
         moves to the bottom of the page. -->
    <div class="customize cz-end">{@render customize()}</div>
  </div>

  {#if phone.current}
    <Sheet open={editing} detent="large" onclose={() => (editing = false)} label="Customize Home">
      <div class="cz-head">
        <h2 class="cz-title">Customize Home</h2>
        <button class="done" type="button" onclick={() => (editing = false)}>Done</button>
      </div>
      {@render cardLists()}
    </Sheet>
  {/if}
{/if}

{#snippet caption(text: string, href: string)}
  <a class="g-link" {href}>{text}</a><span class="g-go" aria-hidden="true">›</span>
{/snippet}

{#snippet customize()}
  {#if editing && !phone.current}
    <!-- : two labelled cards, a toggle per row, saved as you go. -->
    <section class="cz" aria-label="Customize Home">
      <div class="cz-head">
        <h2 class="cz-title">Customize Home</h2>
        <button class="done" type="button" onclick={() => (editing = false)}>Done</button>
      </div>
      {@render cardLists()}
    </section>
  {:else}
    <Btn variant="ghost" size="sm" onclick={() => (editing = true)}>Customize Home</Btn>
  {/if}
{/snippet}

{#snippet cardLists()}
  <div class="cz-cols">
    {#each [{ label: 'At a glance', cards: offered.filter((c) => c.place === 'glance') }, { label: 'Cards', cards: offered.filter((c) => c.place !== 'glance') }] as group (group.label)}
      <div class="cz-group">
        <h3 class="section-label">{group.label}</h3>
        <div class="cz-card">
          {#each group.cards as c (c.id)}
            <div class="card-opt">
              <div class="opt-copy">
                <div class="opt-name">{c.label}</div>
                <div class="opt-desc">{c.description}</div>
              </div>
              <Toggle label={c.label} checked={has(c.id)} onchange={(v) => setCard(c.id, v)} />
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
  <p class="cz-note">The month at the top always shows. Changes save as you go.</p>
{/snippet}

<style>
  .pmf {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .pmf-q {
    margin: 0;
    font-size: 17px;
    font-weight: 500;
    line-height: 1.35;
  }

  .pmf-a {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .pmf-b {
    min-height: 0;
    margin: 0;
    padding: 10px 16px;
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 15px;
    cursor: pointer;
  }

  .pmf-b:hover {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent-text);
  }

  .pmf-skip {
    align-self: flex-start;
    min-height: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-3);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }

  .kept {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .kept-fig {
    font-size: 22px;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .kept .sub {
    font-size: 14px;
    text-align: left;
  }

  .kept-ask {
    margin-top: 10px;
  }

  .home {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--rail-w);
    gap: 32px;
    align-items: start;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 32px;
    min-width: 0;
  }

  .hero-copy {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-align: center;
  }

  .hero-fig {
    font-size: var(--fs-hero-desktop);
    font-weight: 500;
    letter-spacing: var(--ls-hero);
    line-height: 1.1;
    color: var(--ink);
  }

  .unit {
    font-weight: 400;
    color: var(--ink-2);
  }

  .faint {
    color: var(--ink-3);
  }

  .sub {
    font-size: 16px;
    color: var(--ink-2);
  }

  .sub :global(.figure) {
    color: var(--ink-2);
  }

  .text-link {
    font-size: 14px;
    font-weight: 500;
    color: var(--accent-text);
  }

  .empty-line {
    margin: 12px 0 0;
    font-size: 15px;
    color: var(--ink-2);
    max-width: 320px;
  }

  .empty-actions {
    margin-top: 28px;
    padding-top: 16px;
    border-top: 1px dashed var(--line);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .mark {
    padding: 12px;
    border-top: 1px solid var(--line);
  }

  .caught {
    display: flex;
    gap: 14px;
    align-items: center;
  }

  .check,
  .paid {
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--ok);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 700;
  }

  .caught-title {
    font-size: 16px;
    font-weight: 500;
  }

  .caught-sub {
    font-size: 14px;
    color: var(--ink-2);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border-radius: var(--r-tile);
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--ink);
    line-height: normal;
    min-width: 0;
  }

  .tile:hover {
    background: var(--pill);
  }

  .tile-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .emoji {
    font-size: 20px;
  }

  .paid {
    width: 22px;
    height: 22px;
    font-size: 13px;
  }

  .date {
    padding: 2px 8px;
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-2);
    white-space: nowrap;
  }

  .tile-name {
    margin-bottom: -8px;
    font-size: 14px;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tile-amt {
    font-size: 16px;
  }

  .date.missed {
    border-color: var(--watch);
    color: var(--watch-text);
  }

  .tile-missed {
    font-size: 14px;
    color: var(--ink-2);
  }

  .finding {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .finding-text {
    margin: 0;
    font-size: 17px;
    line-height: 1.45;
    color: var(--ink);
    text-wrap: pretty;
  }

  /* Advisor figures are always underlined (v2). */
  .adv-rich :global(a),
  .adv-rich :global(.figure) {
    color: var(--ink);
    font-weight: 500;
    text-decoration: underline dotted var(--accent);
    text-underline-offset: 4px;
  }

  /* ---- glances ---- */
  /* The card picks its columns from its own width, not the window's. */
  .glance-wrap {
    container-type: inline-size;
  }

  /* One card; the 1px gap over --line draws the hairlines between cells. */
  .glance-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1px;
    background: var(--line);
    border-radius: var(--r-card);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .glance-card.n2,
  .glance-card.n4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .glance-card.n3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @container (min-width: 880px) {
    .glance-card.n4 {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  /* A tile: caption and chevron, the figure, then its context. */
  .glance {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'cap go'
      'fig fig'
      'ctx ctx';
    align-content: start;
    min-width: 0;
    padding: 18px 20px 20px;
    background: var(--surface);
    line-height: normal;
  }

  /* One tile: a wide row -- figure and context side by side. */
  .n1 .glance {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'cap cap go'
      'fig ctx go';
    column-gap: 28px;
    align-items: center;
  }

  .glance:hover {
    background: var(--panel);
  }

  .g-link {
    grid-area: cap;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 500;
    color: var(--ink-2);
  }

  /* The caption is the tile's link; this stretches it over the whole cell. */
  .g-link::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .g-link:focus-visible {
    outline: none;
  }

  .glance:has(.g-link:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .g-go {
    grid-area: go;
    align-self: start;
    font-size: 18px;
    line-height: 1;
    color: var(--ink-3);
  }

  .n1 .g-go {
    align-self: center;
  }

  .glance:hover .g-go {
    color: var(--accent-text);
  }

  /* Sums of transactions sit above the stretched link, as siblings of it. */
  .glance :global(a.figure) {
    position: relative;
    z-index: 1;
  }

  .g-fig {
    grid-area: fig;
    font-size: 28px;
    font-weight: 500;
    letter-spacing: -0.01em;
    line-height: 1.15;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .g-fig .unit {
    font-size: 15px;
    font-weight: 400;
    letter-spacing: 0;
    color: var(--ink-2);
  }

  .g-fig.faint {
    font-weight: 400;
    color: var(--ink-2);
  }

  .g-ctx {
    grid-area: ctx;
    margin-top: 4px;
    min-width: 0;
  }

  .n1 .g-ctx {
    margin-top: 0;
  }

  .g-sub {
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink-2);
  }

  /* Tile copy (.w) and the phone row's shorter copy (.n). */
  .n {
    display: none;
  }

  .g-sub :global(.figure) {
    color: var(--ink-2);
  }

  .g-sub :global(.figure.in-fig) {
    color: var(--money-in-text);
  }

  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 5px;
    border-radius: 50%;
    vertical-align: 1px;
  }

  .dot.in {
    background: var(--money-in);
  }

  .dot.out {
    background: var(--money-out);
  }

  .dot.watch {
    background: var(--watch);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* ---- goals ---- */
  .goal {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 20px;
    color: var(--ink);
  }

  .goal + .goal {
    border-top: 1px solid var(--line);
  }

  .goal:hover {
    background: var(--pill);
  }

  .goal-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 16px;
  }

  .goal-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .goal-pct {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .goal-bar {
    position: relative;
    height: 6px;
    border-radius: 3px;
    background: var(--track);
    overflow: hidden;
  }

  .goal-fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 3px;
    background: var(--ink-3);
  }

  .goal-fill.ok {
    background: var(--ok);
  }

  .goal-fill.watch {
    background: var(--watch);
  }

  .goal-sub {
    font-size: 13px;
    color: var(--ink-2);
  }

  .behind {
    color: var(--watch-text);
  }

  /* ---- top places ---- */
  .place {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 14px 20px;
    font-size: 16px;
  }

  .place + .place {
    border-top: 1px solid var(--line);
  }

  .place-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .place-n {
    font-size: 13px;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }

  /* ---- customize ---- */
  .customize {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }

  .cz-end {
    display: none;
    grid-column: 1 / -1;
  }

  .cz {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .cz-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0 4px;
  }

  .cz-title {
    margin: 0;
    font-size: 20px;
    font-weight: 500;
    letter-spacing: var(--ls-title);
  }

  .cz-cols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
    align-items: start;
  }

  .cz-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  .cz-group .section-label {
    margin: 0;
    padding: 0 4px;
  }

  .cz-card {
    background: var(--surface);
    border-radius: var(--r-card);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .card-opt {
    display: flex;
    align-items: center;
    gap: 16px;
    min-height: 64px;
    padding: 12px 16px;
    min-width: 0;
  }

  .card-opt + .card-opt {
    border-top: 1px solid var(--line);
  }

  .opt-copy {
    flex: 1 1 auto;
    min-width: 0;
  }

  .opt-name {
    font-size: 16px;
    color: var(--ink);
  }

  .opt-desc {
    font-size: 14px;
    color: var(--ink-3);
  }

  .cz-note {
    margin: 0;
    padding: 0 4px;
    font-size: 14px;
    color: var(--ink-2);
  }

  /* Resets every property the global `button` rule sets. */
  .done {
    min-height: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 16px;
    font-weight: 500;
    color: var(--accent-text);
    cursor: pointer;
  }

  .done:hover {
    background: none;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .done:active {
    transform: none;
  }

  /* The phone's sheet: one column, cards set off from the sheet. */
  :global(.sheet) .cz-head {
    margin: 4px 0 18px;
  }

  :global(.sheet) .cz-cols {
    grid-template-columns: minmax(0, 1fr);
    gap: 22px;
  }

  :global(.sheet) .cz-card {
    background: var(--sheet-card);
    box-shadow: none;
  }

  :global(.sheet) .cz-note {
    margin-top: 18px;
  }

  @media (max-width: 1100px) {
    .home {
      grid-template-columns: minmax(0, 1fr);
    }

    .cz-main {
      display: none;
    }

    .cz-end {
      display: flex;
    }
  }

  @media (max-width: 760px) {
    .home,
    .col {
      gap: 28px;
    }

    .hero-fig {
      font-size: var(--fs-hero-phone);
    }

    /* Phone: one card of rows -- caption and context left, the
       figure right, then the chevron. */
    .glance-card.glance-card {
      grid-template-columns: minmax(0, 1fr);
    }

    .glance.glance {
      grid-template-columns: minmax(0, 1fr) auto auto;
      grid-template-areas:
        'cap fig go'
        'ctx fig go';
      column-gap: 12px;
      align-items: center;
      min-height: 64px;
      padding: 14px 16px;
    }

    .g-link {
      margin-bottom: 2px;
      font-size: 16px;
      color: var(--ink);
    }

    .g-go.g-go {
      align-self: center;
    }

    .g-fig {
      font-size: 17px;
      letter-spacing: 0;
      text-align: right;
    }

    .g-fig .unit {
      font-size: 14px;
    }

    .g-ctx {
      margin-top: 0;
    }

    .w {
      display: none;
    }

    .n {
      display: block;
    }

    .unit.n {
      display: inline;
    }

    /* A 44px target around a figure link without moving the line. */
    .glance :global(a.figure) {
      display: inline-block;
      padding: 12px 0;
      margin: -12px 0;
    }

  }
</style>
