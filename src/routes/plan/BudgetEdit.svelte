<script lang="ts">
  import { act } from '$lib/client/act';
  import { toast } from '$lib/toast.svelte';
  import { tick } from 'svelte';

  /**
   * A budget amount you can change where it is shown (v2: budgets are
   * edited on Plan rows, not in Settings). Click, type, Enter or leave the
   * field to save; Esc puts it back. A suggested bill budget (the recurring
   * charge, no limit set yet) reads in italics until it is saved.
   */
  let {
    categoryId,
    amount,
    suggested = false,
    name
  }: { categoryId: string; amount: number; suggested?: boolean; name: string } = $props();

  let editing = $state(false);
  let value = $state('');
  let input = $state<HTMLInputElement | null>(null);

  async function open() {
    value = amount > 0 ? String(Math.round(amount)) : '';
    editing = true;
    await tick();
    input?.select();
  }

  async function save() {
    if (!editing) return;
    editing = false;
    const v = value.replace(/[$,\s]/g, '');
    if (v === String(Math.round(amount)) && !suggested) return;
    try {
      await act('set', { categoryId, amount: v }, { path: '/plan' });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    }
  }
</script>

{#if editing}
  <input
    bind:this={input}
    class="edit"
    inputmode="decimal"
    aria-label="Monthly budget for {name}"
    bind:value
    onblur={save}
    onkeydown={(e) => {
      if (e.key === 'Enter') input?.blur();
      if (e.key === 'Escape') editing = false;
    }}
  />
{:else}
  <button type="button" class="amt-btn" class:suggested onclick={open} aria-label="Edit {name} budget"
    ><span class="amt">{amount > 0 ? '$' + Math.round(amount).toLocaleString('en-US') : 'Set'}</span></button
  >
{/if}

<style>
  .amt-btn {
    min-height: 0;
    padding: 2px 4px;
    margin: -2px -4px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ink-3);
    font: inherit;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    cursor: text;
    text-align: left;
  }

  .amt-btn:hover {
    background: var(--pill);
    color: var(--ink);
  }

  .amt-btn:active {
    transform: none;
  }

  .suggested {
    font-style: italic;
  }

  .edit {
    width: 100%;
    min-height: 0;
    padding: 4px 6px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    box-shadow: 0 0 0 3px var(--accent-soft);
    background: var(--field);
    font-size: 16px;
    font-variant-numeric: tabular-nums;
  }
</style>
