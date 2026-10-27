<script lang="ts">
  import { tick } from 'svelte';
  import { act } from '$lib/client/act';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import { drillHref } from '$lib/drill';
  import { toast } from '$lib/toast.svelte';

  /**
   * Categories: the list itself -- names, emoji, merges. Budget
   * amounts are edited on Plan's rows, not here. Grouped Everyday · Bills ·
   * Income, each with how often it was used this year.
   */
  let { data } = $props();
  type Cat = (typeof data.categories)[number];

  let q = $state('');
  let open = $state<string | null>(null);
  let mode = $state<'edit' | 'new' | 'merge' | null>(null);
  let draft = $state({ name: '', icon: '', group: 'expense', color: '#6f7178' });
  let mergeFrom = $state('');
  let mergeInto = $state('');

  const matches = (c: Cat) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase());
  const groups = $derived([
    { label: 'Everyday', rows: data.categories.filter((c) => c.group === 'expense' && !c.bill && matches(c)) },
    { label: 'Bills', rows: data.categories.filter((c) => c.bill && matches(c)) },
    { label: 'Income', rows: data.categories.filter((c) => c.group === 'income' && matches(c)) },
    { label: 'Other', rows: data.categories.filter((c) => c.group === 'transfer' && matches(c)) }
  ].filter((g) => g.rows.length));

  function edit(c: Cat) {
    if (open === c.id) {
      open = null;
      return;
    }
    open = c.id;
    mode = 'edit';
    draft = { name: c.name, icon: c.icon ?? '', group: c.group, color: c.color };
  }

  /**
   * "+ New category", "Merge two" and "Merge into…" open a form at the top of
   * the page, usually far above the button pressed. Bring it into view and
   * focus its first field, or the press looks like it did nothing.
   */
  let panel = $state<HTMLDivElement>();
  async function openForm(m: 'new' | 'merge') {
    mode = m;
    open = null;
    await tick();
    if (!panel) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    // Merge into… arrives with the first pick made; start on the second.
    const field = panel.querySelectorAll<HTMLElement>('input, select')[m === 'merge' && mergeFrom ? 1 : 0];
    field?.focus({ preventScroll: true });
  }

  async function run(action: string, fields: Record<string, string>, done: string) {
    try {
      await act(action, fields, { path: '/settings/categories' });
      toast.show(done);
      open = null;
      mode = null;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    }
  }
</script>

<svelte:head><title>Categories · HTMFD</title></svelte:head>

<div class="cats">
  <h1>Categories</h1>

  <input class="search" type="search" bind:value={q} placeholder="Search {data.categories.length} categories" aria-label="Search categories" />

  {#if mode === 'new' || mode === 'merge'}
    <div class="panel" bind:this={panel}>
    <Section label={mode === 'new' ? 'New category' : 'Merge two categories'}>
    <Card pad="body">
      {#if mode === 'new'}
        <form
          class="form"
          onsubmit={(e) => {
            e.preventDefault();
            run('create', { ...draft }, `Added ${draft.name}`);
          }}
        >
          <div class="two">
            <label><span>Emoji</span><input class="emoji-in" bind:value={draft.icon} maxlength="4" placeholder="🙂" /></label>
            <label class="grow"><span>Name</span><input bind:value={draft.name} required /></label>
          </div>
          <label
            ><span>Kind</span><select bind:value={draft.group}
              ><option value="expense">Spending</option><option value="income">Income</option><option value="transfer"
                >Transfer</option
              ></select
            ></label
          >
          <div class="acts">
            <Btn variant="secondary" onclick={() => (mode = null)}>Cancel</Btn>
            <Btn variant="primary" type="submit">Add category</Btn>
          </div>
        </form>
      {:else}
        <form
          class="form"
          onsubmit={(e) => {
            e.preventDefault();
            const from = data.categories.find((c) => c.id === mergeFrom);
            const into = data.categories.find((c) => c.id === mergeInto);
            if (!from || !into || from.id === into.id) return toast.show('Pick two different categories.');
            run('remove', { id: from.id, replacementId: into.id }, `Merged ${from.name} into ${into.name}`);
          }}
        >
          <label
            ><span>Merge</span><select bind:value={mergeFrom}
              ><option value="">Pick one</option>{#each data.categories as c (c.id)}<option value={c.id}>{c.icon ?? ''} {c.name}</option>{/each}</select
            ></label
          >
          <label
            ><span>Into</span><select bind:value={mergeInto}
              ><option value="">Pick one</option>{#each data.categories as c (c.id)}<option value={c.id}>{c.icon ?? ''} {c.name}</option>{/each}</select
            ></label
          >
          <p class="s">Every transaction, merchant and rule moves over; the first one goes away.</p>
          <div class="acts">
            <Btn variant="secondary" onclick={() => (mode = null)}>Cancel</Btn>
            <Btn variant="primary" type="submit" disabled={!mergeFrom || !mergeInto}>Merge</Btn>
          </div>
        </form>
      {/if}
    </Card>
    </Section>
    </div>
  {/if}

  {#each groups as g (g.label)}
    <Section label={g.label}>
      <Card>
        {#each g.rows as c (c.id)}
          <button type="button" class="crow" class:open={open === c.id} onclick={() => edit(c)}>
            <span class="emoji" aria-hidden="true">{c.icon ?? '•'}</span>
            <span class="nm">{c.name}</span>
            <span class="n">{c.yearCount} this year</span>
            <span class="chev" aria-hidden="true">›</span>
          </button>
          {#if open === c.id && mode === 'edit'}
            <form
              class="form inline"
              onsubmit={(e) => {
                e.preventDefault();
                run('update', { id: c.id, ...draft }, `Saved ${draft.name}`);
              }}
            >
              <div class="two">
                <label><span>Emoji</span><input class="emoji-in" bind:value={draft.icon} maxlength="4" /></label>
                <label class="grow"><span>Name</span><input bind:value={draft.name} required /></label>
              </div>
              <div class="links">
                <a href={drillHref({ category: c.id })}>{c.txnCount} transactions ›</a>
                {#if c.ruleCount}<a href="/settings/rules">{c.ruleCount} rule{c.ruleCount === 1 ? '' : 's'} ›</a>{/if}
              </div>
              <div class="acts">
                {#if !c.isSystem}
                  <Btn
                    variant="ghost"
                    onclick={() => {
                      mergeFrom = c.id;
                      mergeInto = '';
                      openForm('merge');
                    }}>Merge into…</Btn
                  >
                {/if}
                <span class="sp"></span>
                <Btn variant="secondary" onclick={() => (open = null)}>Cancel</Btn>
                <Btn variant="primary" type="submit">Save</Btn>
              </div>
            </form>
          {/if}
        {/each}
      </Card>
    </Section>
  {/each}

  <div class="bottom">
    <Btn
      variant="soft"
      onclick={() => {
        draft = { name: '', icon: '', group: 'expense', color: '#6f7178' };
        openForm('new');
      }}>+ New category</Btn
    >
    <Btn
      variant="secondary"
      onclick={() => {
        mergeFrom = '';
        mergeInto = '';
        openForm('merge');
      }}>Merge two</Btn
    >
  </div>
</div>

<style>
  .cats {
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 720px;
    line-height: normal;
  }

  /* Clears the sticky top bar when scrolled to. */
  .panel {
    scroll-margin-top: 96px;
  }


  h1 {
    margin: 0;
  }

  .search,
  .form input,
  .form select {
    border-radius: var(--r-field);
    border-color: var(--line);
    background: var(--field);
  }

  .search {
    background: var(--surface);
  }

  .crow {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto 12px;
    gap: 12px;
    align-items: center;
    width: 100%;
    min-height: 0;
    margin: 0;
    padding: 13px 18px;
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .crow:first-child {
    border-top: 0;
  }

  .crow:hover,
  .crow.open {
    background: var(--pill);
  }

  .crow:active {
    transform: none;
  }

  .emoji {
    font-size: 18px;
    text-align: center;
  }

  .nm {
    font-size: 16px;
  }

  .n {
    font-size: 13px;
    color: var(--ink-3);
  }

  .chev {
    color: var(--ink-3);
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form.inline {
    padding: 14px 18px 16px;
    background: var(--pill);
  }

  .form label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form label span {
    font-size: 13px;
    color: var(--ink-3);
  }

  .two {
    display: flex;
    gap: 10px;
  }

  .grow {
    flex: 1 1 auto;
  }

  .emoji-in {
    width: 70px;
    text-align: center;
  }

  .links {
    display: flex;
    gap: 16px;
    font-size: 14px;
  }

  .links a {
    color: var(--accent-text);
    font-weight: 500;
  }

  .acts {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }

  .sp {
    flex: 1 1 auto;
  }

  .s {
    margin: 0;
    font-size: 13px;
    color: var(--ink-3);
  }

  .bottom {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .bottom :global(.btn2) {
    border-radius: var(--r-pill);
  }

</style>
