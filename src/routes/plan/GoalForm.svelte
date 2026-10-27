<script lang="ts">
  import { act } from '$lib/client/act';
  import Btn from '$lib/components/ui/Btn.svelte';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import { toast } from '$lib/toast.svelte';

  /**
   * New goal / edit goal. Two shapes behind one form: grow a balance (a
   * savings account, or an amount entered by hand) or pay one down to zero (a
   * loan or a card). A linked goal snapshots the account's balance as its
   * starting point on the server -- never recomputed later.
   */
  type Acct = { id: string; label: string; type: string; balance: number };
  type Goal = {
    id: string;
    name: string;
    target: number;
    targetDate: Date | string | null;
    accountId: string | null;
    current: number;
    direction: 'save' | 'payoff';
  };
  let {
    accounts,
    goal,
    onclose,
    initialKind = 'save',
    initialAccount = '',
    initial = {}
  }: {
    accounts: Acct[];
    goal?: Goal;
    onclose: () => void;
    initialKind?: 'save' | 'payoff';
    initialAccount?: string;
    /** Filled in from an Advisor answer's "Set up goal". */
    initial?: { name?: string; target?: string; date?: string };
  } = $props();

  // svelte-ignore state_referenced_locally
  let kind = $state<'save' | 'payoff'>(goal?.direction ?? initialKind);
  // svelte-ignore state_referenced_locally
  let name = $state(goal?.name ?? initial.name ?? (initialAccount ? `Pay off ${accounts.find((a) => a.id === initialAccount)?.label ?? 'the loan'}` : ''));
  // svelte-ignore state_referenced_locally
  let accountId = $state(goal?.accountId ?? initialAccount);
  // svelte-ignore state_referenced_locally
  let target = $state(goal ? String(Math.abs(goal.target)) : (initial.target ?? ''));
  // svelte-ignore state_referenced_locally
  let date = $state(goal?.targetDate ? new Date(goal.targetDate).toLocaleDateString('en-CA') : (initial.date ?? ''));
  // svelte-ignore state_referenced_locally
  let current = $state(goal && !goal.accountId ? String(goal.current) : '');
  let busy = $state(false);

  const choices = $derived(
    // A paid-off loan has nothing to pay down; picking one could only fail.
    accounts.filter((a) =>
      kind === 'save' ? ['depository', 'investment'].includes(a.type) : ['loan', 'credit'].includes(a.type) && a.balance < 0
    )
  );

  async function save(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    try {
      if (goal) {
        await act(
          'update',
          {
            id: goal.id,
            name,
            target: kind === 'payoff' ? '0' : target,
            targetDate: date,
            ...(goal.accountId ? {} : { current })
          },
          { path: '/plan?tab=goals' }
        );
      } else {
        await act(
          'create',
          {
            name,
            target: kind === 'payoff' ? '0' : target,
            accountId,
            starting: kind === 'payoff' && !accountId ? String(-Math.abs(Number(current) || 0)) : current,
            targetDate: date
          },
          { path: '/plan?tab=goals' }
        );
        toast.show(`Goal set · ${name}`);
      }
      onclose();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }
</script>

<form class="gf" onsubmit={save}>
  {#if !goal}
    <SegmentedControl
      label="Kind of goal"
      items={[
        { key: 'save', label: 'Grow a balance' },
        { key: 'payoff', label: 'Pay one down' }
      ]}
      value={kind}
      onselect={(k) => {
        kind = k as 'save' | 'payoff';
        accountId = '';
      }}
    />
  {/if}
  <label>
    <span>Name</span>
    <input bind:value={name} required placeholder={kind === 'save' ? 'Emergency fund' : 'Pay off the car'} />
  </label>
  {#if !goal}
    <label>
      <span>{kind === 'save' ? 'Saving in' : 'Paying down'}</span>
      <select bind:value={accountId}>
        <option value="">Enter it by hand</option>
        {#each choices as a (a.id)}<option value={a.id}>{a.label}</option>{/each}
      </select>
    </label>
  {/if}
  {#if kind === 'save'}
    <label>
      <span>Target</span>
      <input inputmode="decimal" bind:value={target} required placeholder="10,000" />
    </label>
  {/if}
  {#if (!goal && !accountId) || (goal && !goal.accountId)}
    <label>
      <span>{kind === 'save' ? 'Saved so far' : 'Owed now'}</span>
      <input inputmode="decimal" bind:value={current} placeholder="0" required={kind === 'payoff'} />
    </label>
  {/if}
  <label>
    <span>By</span>
    <input type="date" bind:value={date} />
  </label>
  <div class="acts">
    <Btn variant="secondary" onclick={onclose}>Cancel</Btn>
    <Btn variant="primary" type="submit" disabled={busy || !name.trim()}>{goal ? 'Save' : 'Set goal'}</Btn>
  </div>
</form>

<style>
  .gf {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label span {
    font-size: 13px;
    color: var(--ink-3);
  }

  input,
  select {
    border-radius: var(--r-field);
    border-color: var(--line);
    background: var(--field);
  }

  .acts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px;
    margin-top: 6px;
  }
</style>
