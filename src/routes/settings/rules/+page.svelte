<script lang="ts">
  import { act } from '$lib/client/act';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import CategoryPill from '$lib/components/ui/CategoryPill.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import Tip from '$lib/components/ui/Tip.svelte';
  import Toggle from '$lib/components/ui/Toggle.svelte';
  import { toast } from '$lib/toast.svelte';

  /**
   * Rules: for checking and switching rules off, not for making
   * them -- that happens on a transaction ("Always use for …" in the
   * category picker). Newest first, each with what it matches, what it sets,
   * and how often it applies.
   */
  let { data } = $props();
  type Rule = (typeof data.rules)[number];

  let q = $state('');
  let open = $state<string | null>(null);

  const rules = $derived(
    [...data.rules]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((r) => {
        const s = q.trim().toLowerCase();
        return !s || r.name.toLowerCase().includes(s) || r.matchValue.toLowerCase().includes(s) || (r.categoryName ?? '').toLowerCase().includes(s);
      })
  );

  const isToday = (d: Date | string) => new Date(d).toDateString() === new Date().toDateString();
  const fromTxn = (r: Rule) => r.matchField === 'normalized' && r.matchType === 'equals';
  const title = (r: Rule) =>
    fromTxn(r) ? r.name.replace(/^Always /, '') : r.matchType === 'equals' ? `"${r.matchValue}"` : r.name || r.matchValue;

  async function toggle(r: Rule) {
    try {
      await act('toggle', { id: r.id }, { path: '/settings/rules' });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(r: Rule) {
    try {
      await act('remove', { id: r.id }, { path: '/settings/rules' });
      toast.show(`Deleted the rule for ${title(r)}`);
      open = null;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    }
  }
</script>

<svelte:head><title>Rules · HTMFD</title></svelte:head>

<div class="rules">
  <h1>Rules</h1>
  <input class="search" type="search" bind:value={q} placeholder="Search rules" aria-label="Search rules" />

  <Section label="{data.rules.length} rule{data.rules.length === 1 ? '' : 's'}" note="newest first">
    <Card>
      {#each rules as r (r.id)}
        <div class="rrow" class:off={!r.enabled}>
          <button type="button" class="main" onclick={() => (open = open === r.id ? null : r.id)}>
            <span class="t">{title(r)}</span>
            <span class="does">
              <span class="arrow" aria-hidden="true">→</span>
              {#if r.setCategoryId}
                <CategoryPill name={r.categoryName} icon={r.categoryIcon} />
              {:else if r.setIsTransfer}
                <CategoryPill name="Transfer" icon="↔️" />
              {:else if r.setExcluded}
                <span class="m">Hide from totals</span>
              {:else if r.setMerchantName}
                <span class="m">Rename to {r.setMerchantName}</span>
              {:else}
                <span class="m">Ask me each time</span>
              {/if}
            </span>
            {#if fromTxn(r) && isToday(r.createdAt)}
              <span class="made">Made from a transaction · today</span>
            {:else if r.matched !== null}
              <span class="m">Applied {r.matched} time{r.matched === 1 ? '' : 's'}</span>
            {/if}
          </button>
          <Toggle label="Rule for {title(r)} on" checked={r.enabled} onchange={() => toggle(r)} />
        </div>
        {#if open === r.id}
          <div class="more">
            <span class="m">
              {r.matchField === 'normalized' ? 'Merchant' : 'Description'}
              {r.matchType === 'equals' ? 'is' : r.matchType === 'regex' ? 'matches' : 'contains'}
              <code>{r.matchValue}</code>{#if r.accountName} · on {r.accountName}{/if}
            </span>
            <Btn variant="secondary" size="sm" onclick={() => remove(r)}>Delete rule</Btn>
          </div>
        {/if}
      {:else}
        <p class="none">{q ? 'No rule matches that.' : 'No rules yet.'}</p>
      {/each}
    </Card>
  </Section>

  <Tip id="rules-from-transactions" title="Rules start on a transaction">
    The quickest way to add one: open a transaction, change its category and turn on "Always use for…". This list
    is for checking rules and turning them off.
  </Tip>
</div>

<style>
  .rules {
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 720px;
    line-height: normal;
  }


  h1 {
    margin: 0;
  }

  .search {
    border-radius: var(--r-field);
    border-color: var(--line);
    background: var(--surface);
  }

  .rrow {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 18px 4px 0;
    border-top: 1px solid var(--line);
  }

  .rrow:first-child {
    border-top: 0;
  }

  .main {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-height: 0;
    min-width: 0;
    padding: 10px 0 10px 18px;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .main:hover {
    background: none;
  }

  .main:active {
    transform: none;
  }

  .off .t,
  .off .does {
    opacity: 0.55;
  }

  .t {
    font-size: 16px;
  }

  .does {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .arrow {
    color: var(--ink-3);
  }

  .m {
    font-size: 13px;
    color: var(--ink-3);
  }

  .made {
    font-size: 13px;
    color: var(--accent-text);
  }

  .more {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 10px 18px 14px;
    background: var(--pill);
  }

  code {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .none {
    margin: 0;
    padding: 16px 18px;
    color: var(--ink-2);
  }

</style>
