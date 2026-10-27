<script lang="ts">
  import { enhance } from '$app/forms';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Field from '$lib/components/ui/Field.svelte';
  import { toast } from '$lib/toast.svelte';

  /**
   * "Add a recurring bill": one the bank feed never shows -- rent paid by
   * check, a bill on an account that isn't connected, a subscription that
   * hasn't charged yet. It goes on the calendar and into every forecast, and
   * counts as paid on each due date because nothing will post to say so.
   * A charge that does come through a bank is better marked from Activity
   * ("Mark as recurring"), which follows the real amounts.
   */
  type Cat = { id: string; name: string; icon: string | null };
  let { categories, today, onclose }: { categories: Cat[]; today: string; onclose: () => void } = $props();

  const CADENCES = [
    { days: 7, label: 'Every week' },
    { days: 14, label: 'Every 2 weeks' },
    { days: 30, label: 'Every month' },
    { days: 90, label: 'Every 3 months' },
    { days: 365, label: 'Every year' }
  ];

  let name = $state('');
  let amount = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
</script>

<form
  class="ab"
  method="POST"
  action="?/addBill"
  use:enhance={() => {
    saving = true;
    error = null;
    return async ({ result, update }) => {
      saving = false;
      if (result.type === 'failure') {
        error = String(result.data?.addBill ?? "Couldn't add it.");
        return;
      }
      const added = name.trim();
      await update({ reset: false });
      onclose();
      toast.show(`Added · ${added} is on the calendar`);
    };
  }}
>
  <div class="head">
    <span class="title">Add a recurring bill</span>
    <span class="sub">For a bill your bank feed doesn't show. One that does is better marked from Activity.</span>
  </div>

  <Field label="Name" name="name" bind:value={name} placeholder="Rent" autocomplete="off" required />
  <Field label="Amount" name="amount" bind:value={amount} inputmode="decimal" placeholder="$0.00" required />
  <Field label="How often">
    {#snippet control(id)}
      <select {id} name="cadence">
        {#each CADENCES as c (c.days)}<option value={c.days} selected={c.days === 30}>{c.label}</option>{/each}
      </select>
    {/snippet}
  </Field>
  <Field label="Next due" name="nextDue" type="date" value={today} required />
  <Field label="Category" aside="optional">
    {#snippet control(id)}
      <select {id} name="categoryId">
        <option value="">None</option>
        {#each categories as c (c.id)}<option value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>{/each}
      </select>
    {/snippet}
  </Field>

  {#if error}<p class="err" role="alert">{error}</p>{/if}

  <div class="btns">
    <Btn variant="primary" type="submit" disabled={saving || !name.trim() || !amount.trim()}>
      {saving ? 'Adding…' : 'Add bill'}
    </Btn>
    <Btn variant="ghost" onclick={onclose}>Cancel</Btn>
  </div>
</form>

<style>
  .ab {
    display: flex;
    flex-direction: column;
    gap: 14px;
    line-height: normal;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .title {
    font-size: 20px;
    font-weight: 500;
  }

  .sub {
    font-size: 14px;
    color: var(--ink-2);
  }

  .err {
    margin: 0;
    font-size: 14px;
    color: var(--over-text);
  }

  .btns {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
</style>
