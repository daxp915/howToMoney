<script lang="ts">
  import { act } from '$lib/client/act';
  import Btn from '$lib/components/ui/Btn.svelte';
  import CategoryPill from '$lib/components/ui/CategoryPill.svelte';
  import Money from '$lib/components/ui/Money.svelte';
  import MaskedText from '$lib/components/MaskedText.svelte';
  import { usd } from '$lib/money';
  import { toast } from '$lib/toast.svelte';
  import type { Detail } from '$lib/server/activity';
  import Picker from './Picker.svelte';
  import Split from './Split.svelte';

  /**
   * One transaction. The same content in
   * the desktop panel and the phone sheet; the sheet's medium height shows the
   * short version and "Swipe up for details". Category changes, review, the
   * note, hide and split all happen here without leaving the list.
   */
  type Cat = { id: string; name: string; icon: string | null };
  let {
    d,
    categories,
    mode,
    compact = false,
    onclose,
    onexpand,
    reload
  }: {
    d: Detail;
    categories: Cat[];
    mode: 'panel' | 'sheet';
    compact?: boolean;
    onclose: () => void;
    onexpand?: () => void;
    reload: () => Promise<void>;
  } = $props();

  let view = $state<'detail' | 'picker' | 'split'>('detail');
  let ruleFirst = $state(false);
  let busy = $state(false);
  // svelte-ignore state_referenced_locally
  let note = $state(d.note);
  $effect(() => {
    note = d.note;
    view = 'detail';
  });

  const when = $derived(new Date(d.when));
  const dateLabel = $derived(
    when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
      (d.hasTime ? ' · ' + when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false }) : '')
  );
  const shortDate = $derived(when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
  const kind = $derived(d.isTransfer ? 'transfer' : d.amount > 0 ? 'income' : 'spend');
  const stripMax = $derived(Math.max(1, ...d.strip.map((s) => s.total)));
  const isParent = $derived(d.parts.length > 0);

  async function run(fn: () => Promise<unknown>) {
    busy = true;
    try {
      await fn();
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }

  const review = () =>
    run(() => act('review', d.unreviewed ? { id: d.id } : { id: d.id, undo: '1' }, { path: '/transactions' }));

  const pick = (categoryId: string, always: boolean) =>
    run(async () => {
      view = 'detail';
      await act('category', { id: d.id, categoryId, ...(always ? { always: 'on' } : {}) }, { path: '/transactions' });
      const c = categories.find((x) => x.id === categoryId);
      if (always) toast.show(`Rule made · ${d.merchant} is always ${c?.name ?? 'that'}`);
    });

  const saveNote = () => {
    if (note === d.note) return;
    run(() => act('note', { id: d.id, note }, { path: '/transactions', refresh: false }));
  };

  const hide = () =>
    run(async () => {
      await act('hide', { id: d.id, hidden: d.excluded ? '0' : '1' }, { path: '/transactions' });
      if (!d.excluded)
        toast.show('Hidden from every total', () =>
          run(() => act('hide', { id: d.id, hidden: '0' }, { path: '/transactions' }))
        );
    });

  async function saveSplit(parts: { categoryId: string; amount: number }[]) {
    await act('split', { id: d.id, parts: JSON.stringify(parts) }, { path: '/transactions' });
    view = 'detail';
    const names = [...new Set(parts.map((p) => categories.find((c) => c.id === p.categoryId)?.name))].filter(
      (n) => n && n !== d.categoryName
    );
    toast.show(
      `Split into ${parts.length}` + (names.length ? ` · ${names[0]} budget updated` : ''),
      () => run(() => act('unsplit', { id: d.id }, { path: '/transactions' }))
    );
    await reload();
  }

  const unsplit = (id: string) => run(() => act('unsplit', { id }, { path: '/transactions' }));

  // ---- recurring: "Repeats" ------------------------------------------------
  // Detection only finds a charge that has repeated on a steady cadence; this
  // is the person saying so themselves (a new subscription, a bill whose
  // amount swings). A resync never undoes it.
  const CADENCES = [
    { days: 7, label: 'Weekly' },
    { days: 14, label: 'Every 2 weeks' },
    { days: 30, label: 'Monthly' },
    { days: 90, label: 'Every 3 months' },
    { days: 365, label: 'Yearly' }
  ];
  const cadenceText = (days: number) =>
    CADENCES.find((c) => Math.abs(c.days - days) <= (days >= 300 ? 30 : days >= 80 ? 10 : 3))?.label ?? `Every ${days} days`;
  let choosing = $state(false);
  $effect(() => {
    void d.id;
    choosing = false;
  });
  const canRepeat = $derived(kind === 'spend' && !d.isPart && !isParent);

  const markRecurring = (cadence: number) =>
    run(async () => {
      choosing = false;
      await act('recurring', { id: d.id, cadence: String(cadence) }, { path: '/transactions' });
      toast.show(`${d.merchant} repeats ${cadenceText(cadence).toLowerCase()} · on Plan's calendar`);
    });

  const stopRecurring = () =>
    run(async () => {
      const r = d.recurring;
      if (!r) return;
      await act('recurring', { id: d.id, series: r.id, off: '1' }, { path: '/transactions' });
      toast.show(`${d.merchant} no longer counts as recurring`, () => markRecurring(r.cadenceDays));
    });
</script>

{#if view === 'picker'}
  <Picker
    {categories}
    current={d.categoryId}
    merchant={d.merchant}
    pastCount={d.pastCount}
    alwaysDefault={ruleFirst}
    onback={() => (view = 'detail')}
    ondone={pick}
  />
{:else if view === 'split'}
  <Split
    merchant={d.merchant}
    dateLabel={shortDate}
    total={Math.abs(d.amount)}
    {categories}
    backLabel={mode === 'panel' ? 'Transaction' : 'Back'}
    initial={isParent
      ? d.parts.map((p) => ({ categoryId: p.categoryId, amount: Math.abs(p.amount) }))
      : [{ categoryId: d.categoryId, amount: Math.abs(d.amount) }]}
    onback={() => (view = 'detail')}
    onsave={saveSplit}
  />
{:else}
  <div class="detail" class:compact>
    <div class="top">
      <span class="date">{dateLabel}</span>
      <button type="button" class="close" aria-label="Close" onclick={onclose}>×</button>
    </div>

    <div class="who">
      <span class="merchant">{d.merchant}</span>
      <span class="amount {kind}"
        ><Money value={d.amount} abs={kind !== 'income'} plus={kind === 'income'} /></span
      >
    </div>

    {#if compact}
      <div class="quick">
        {#if d.isTransfer}
          <CategoryPill name="Transfer" icon="↔️" />
        {:else}
          <CategoryPill name={d.categoryName} icon={d.categoryIcon} chevron onclick={() => (view = 'picker')} />
        {/if}
        <span class="acct">{d.account.name}{d.account.last4 ? ` ··${d.account.last4}` : ''}</span>
      </div>
      <a class="yearpill" href={d.year.href}>
        <span>This year at {d.merchant}</span>
        <span class="figure"
          >{d.year.count} visit{d.year.count === 1 ? '' : 's'} · <span class="amt">{usd(d.year.total, { cents: false })}</span></span
        >
      </a>
    {:else}
      <div class="kv">
        <div class="row">
          <span class="k">Category</span>
          <span class="v">
            {#if d.isTransfer}
              <CategoryPill name="Transfer" icon="↔️" />
            {:else if isParent}
              <span class="muted">Split in {d.parts.length}</span>
            {:else}
              <CategoryPill name={d.categoryName} icon={d.categoryIcon} chevron onclick={() => (view = 'picker')} />
            {/if}
          </span>
        </div>
        <div class="row">
          <span class="k">Account</span>
          <span class="v">{d.account.name}{d.account.last4 ? ` ··${d.account.last4}` : ''}</span>
        </div>
        {#if canRepeat}
          <div class="row">
            <span class="k">Repeats</span>
            <span class="v">
              {#if d.recurring && !choosing}
                <span class="repeats">
                  <span>{cadenceText(d.recurring.cadenceDays)}{d.recurring.suspected ? ' · probably' : ''}</span>
                  <button type="button" class="linkish" disabled={busy} onclick={() => (choosing = true)}>Change</button>
                  <button type="button" class="linkish quiet" disabled={busy} onclick={stopRecurring}>Stop</button>
                </span>
              {:else if choosing}
                <span class="chips" role="group" aria-label="How often it repeats">
                  {#each CADENCES as c (c.days)}
                    <button
                      type="button"
                      class="chip"
                      class:on={d.recurring && cadenceText(d.recurring.cadenceDays) === c.label}
                      disabled={busy}
                      onclick={() => markRecurring(c.days)}>{c.label}</button
                    >
                  {/each}
                  <button type="button" class="linkish quiet" onclick={() => (choosing = false)}>Cancel</button>
                </span>
              {:else}
                <button type="button" class="linkish" disabled={busy} onclick={() => (choosing = true)}>Mark as recurring</button>
              {/if}
            </span>
          </div>
        {/if}
        <div class="row">
          <span class="k">Bank says</span>
          <span class="v mono"><MaskedText text={d.bankSays} /></span>
        </div>
        {#if mode === 'panel'}
          <div class="row">
            <span class="k">This year</span>
            <span class="v"
              ><a class="figure" href={d.year.href}
                >{d.year.count} visit{d.year.count === 1 ? '' : 's'} · <span class="amt">{usd(d.year.total, { cents: false })}</span></a
              ></span
            >
          </div>
        {:else}
          <div class="row">
            <span class="k">Status</span>
            <span class="v">{d.pending ? 'Pending' : 'Posted'} · {d.unreviewed ? 'not reviewed' : 'reviewed'}</span>
          </div>
        {/if}
      </div>

      {#if isParent}
        <div class="parts">
          {#each d.parts as p (p.id)}
            <div class="partrow">
              <CategoryPill name={p.categoryName} icon={p.categoryIcon} />
              <span class="figure"><span class="amt">{usd(p.amount, { abs: true })}</span></span>
            </div>
          {/each}
        </div>
      {/if}

      {#if mode === 'sheet'}
        <a class="strip" href={d.stripHref}>
          <span class="strip-head">
            <span class="section-label">{d.merchant} · Last 10 months</span>
            <span class="figure"><span class="amt">{usd(d.year.total, { cents: false })}</span></span>
          </span>
          <span class="bars" aria-hidden="true">
            {#each d.strip as s, i (s.month)}
              <span
                class:now={i === d.strip.length - 1}
                style="height: {s.total > 0 ? Math.max(8, (s.total / stripMax) * 100) : 4}%"
              ></span>
            {/each}
          </span>
        </a>
      {/if}

      <textarea
        class="note"
        rows="1"
        placeholder="Add a note"
        aria-label="Note"
        bind:value={note}
        onblur={saveNote}
      ></textarea>
    {/if}

    <div class="actions">
      {#if d.isPart}
        <Btn variant="secondary" full disabled={busy} onclick={() => d.parentId && unsplit(d.parentId)}
          >Undo split</Btn
        >
      {:else if d.unreviewed}
        <Btn variant="primary" full disabled={busy} onclick={review}>Mark as reviewed</Btn>
      {:else}
        <Btn variant="soft" full disabled={busy} onclick={review}>Reviewed ✓ · Mark as not reviewed</Btn>
      {/if}
      {#if compact}
        <button type="button" class="swipe" onclick={onexpand}>Swipe up for details</button>
      {:else if !d.isPart}
        <div class="row-btns" class:three={mode === 'sheet'}>
          {#if isParent}
            <Btn variant="secondary" disabled={busy} onclick={() => (view = 'split')}>Edit split</Btn>
            <Btn variant="secondary" disabled={busy} onclick={() => unsplit(d.id)}>Undo split</Btn>
          {:else}
            <Btn
              variant="secondary"
              disabled={busy || d.pending || d.isTransfer}
              title={d.pending ? 'Split it once it posts' : undefined}
              onclick={() => (view = 'split')}>Split</Btn
            >
            <Btn
              variant="secondary"
              disabled={busy || d.isTransfer}
              onclick={() => {
                ruleFirst = true;
                view = 'picker';
              }}>Make a rule</Btn
            >
          {/if}
          {#if mode === 'sheet'}
            <Btn variant="secondary" disabled={busy || isParent} onclick={hide}>{d.excluded ? 'Unhide' : 'Hide'}</Btn>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 100%;
  }

  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .date {
    font-size: 13px;
    color: var(--ink-3);
  }

  .close {
    width: 32px;
    height: 32px;
    min-height: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--pill);
    color: var(--ink-2);
    font-size: 16px;
    cursor: pointer;
  }

  .who {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .merchant {
    font-size: var(--fs-row-strong);
    font-weight: 500;
  }

  .amount {
    font-size: var(--fs-detail-amount);
    letter-spacing: var(--ls-hero);
    line-height: 1.1;
  }

  .compact .amount {
    font-size: 44px;
  }

  .amount.income :global(.figure) {
    color: var(--money-in-text);
  }

  .amount.transfer :global(.figure) {
    color: var(--ink-2);
  }

  .quick {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .quick :global(.pill) {
    font-size: 15px;
    padding: 8px 14px 8px 12px;
    color: var(--ink);
  }

  .acct {
    font-size: 14px;
    color: var(--ink-3);
  }

  .yearpill {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--r-field);
    background: var(--pill);
    font-size: 14px;
    color: var(--ink-2);
  }

  .yearpill .figure {
    color: var(--ink);
    font-size: 15px;
  }

  .kv {
    display: flex;
    flex-direction: column;
  }

  .kv .row {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    padding: 12px 0;
    border-top: 1px solid var(--line);
  }

  .k {
    font-size: 14px;
    color: var(--ink-3);
  }

  .v {
    font-size: 15px;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .v :global(.pill) {
    font-size: 14px;
    color: var(--ink);
    padding: 5px 12px 5px 9px;
  }

  .mono {
    font: 400 13px var(--font-mono);
    color: var(--ink-2);
  }

  .muted {
    color: var(--ink-2);
  }

  .repeats {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: baseline;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  /* Resets every property the global `button` rule sets. */
  .chip,
  .linkish {
    min-height: 0;
    margin: 0;
    font: inherit;
    cursor: pointer;
  }

  .chip {
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    background: var(--surface);
    font-size: 14px;
    color: var(--ink);
  }

  .chip:hover {
    background: var(--pill);
  }

  .chip.on {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .linkish {
    padding: 0;
    border: 0;
    background: none;
    font-size: 15px;
    font-weight: 500;
    color: var(--accent-text);
  }

  .linkish.quiet {
    font-weight: 400;
    color: var(--ink-2);
  }

  .linkish:hover {
    background: none;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .chip:active,
  .linkish:active {
    transform: none;
  }

  .parts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-left: 12px;
    border-left: 2px solid var(--line);
  }

  .partrow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 15px;
  }

  .strip {
    display: flex;
    flex-direction: column;
    gap: 12px;
    color: var(--ink);
  }

  .strip-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .strip-head .section-label {
    padding: 0;
  }

  .bars {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 56px;
  }

  .bars span {
    flex: 1 1 0;
    border-radius: 3px 3px 1px 1px;
    background: var(--money-out);
  }

  .bars span.now {
    background: var(--money-out-selected);
  }

  .note {
    min-height: 0;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: var(--r-field);
    background: var(--field);
    font-size: 16px;
    resize: none;
    field-sizing: content;
  }

  .actions {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row-btns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .row-btns.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .row-btns :global(.btn2) {
    font-size: 15px;
    padding: 11px 8px;
  }

  .swipe {
    min-height: 0;
    padding: 6px;
    border: 0;
    background: none;
    color: var(--ink-3);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }

  .swipe:hover {
    background: none;
    color: var(--ink-2);
  }
</style>
