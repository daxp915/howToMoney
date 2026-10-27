<script lang="ts">
  import { tint } from '$lib/format';
  import { invalidateAll } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import { keys } from '$lib/keys.svelte';

  /**
   * The one dialog for money the bank feed cannot see.
   *
   * Deliberately not a general "add transaction": the provider imports every
   * card and account purchase on its own, so a typed copy of one becomes a
   * duplicate the moment it posts. What the feed genuinely misses is cash, and
   * anything else tracked by hand -- which is exactly the set of accounts the
   * server will accept here.
   */
  let { onclose, account }: { onclose: () => void; /** Preselected (Wealth's cash account). */ account?: string } = $props();

  interface Account {
    id: string;
    name: string;
    type: string;
  }
  interface Category {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
  }

  let accounts = $state<Account[]>([]);
  let categories = $state<Category[]>([]);
  let loading = $state(true);

  let amount = $state('');
  let merchant = $state('');
  let date = $state(new Date().toLocaleDateString('en-CA')); // yyyy-mm-dd, local
  let accountId = $state('');
  let categoryId = $state<string | null>(null);
  let isIncome = $state(false);
  let note = $state('');
  let showAllCategories = $state(false);

  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let dialog: HTMLElement | undefined = $state();

  // Six chips cover most of what anybody types; the rest are one press away.
  // Twenty-eight at once is a wall, not a choice.
  const QUICK = 6;
  const shownCategories = $derived(showAllCategories ? categories : categories.slice(0, QUICK));

  $effect(() => {
    fetch('/api/expense')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load the form'))))
      .then((d: { accounts: Account[]; categories: Category[] }) => {
        accounts = d.accounts;
        categories = d.categories;
        accountId = d.accounts.find((x) => x.id === account)?.id ?? d.accounts[0]?.id ?? '';
      })
      .catch((e) => (saveError = e instanceof Error ? e.message : String(e)))
      .finally(() => (loading = false));
  });

  // Escape closes, and focus is trapped loosely by autofocusing the amount --
  // a full focus trap is more machinery than a four-field dialog earns.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose();
      // ⌘↵ / Ctrl+Enter saves from anywhere in the dialog, as the design shows.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  async function save() {
    if (saving) return;
    saving = true;
    saveError = null;
    try {
      const res = await fetch('/api/expense', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountId,
          createCashAccount: !accounts.length,
          amount,
          merchant,
          date,
          categoryId,
          note,
          isIncome
        })
      });
      if (!res.ok) throw new Error((await res.text()) || 'Could not save that.');
      await invalidateAll();
      onclose();
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<!-- The backdrop is a real button, so dismissing works by keyboard and screen
     reader as well as by clicking past the dialog. Escape closes it too. -->
<button class="backdrop-hit" type="button" aria-label="Close" onclick={onclose}></button>
<div class="backdrop">
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Add expense" bind:this={dialog}>
    <div class="head">
      <div>
        <h2>{isIncome ? 'Add income' : 'Add expense'}</h2>
        <p class="muted">
          For cash and anything else your bank does not report. Card and account purchases arrive on
          their own.
        </p>
      </div>
      <button class="ghost close" type="button" onclick={onclose} aria-label="Close">
        <Icon name="close" size={18} />
      </button>
    </div>

    {#if loading}
      <p class="muted">Loading…</p>
    {:else}
      <div class="body">
        <div class="field-label">Amount</div>
        <div class="amount-row">
          <span class="currency">$</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="amount"
            bind:value={amount}
            inputmode="decimal"
            placeholder="0.00"
            autofocus
            aria-label="Amount"
          />
          <button
            type="button"
            class="dir"
            class:income={isIncome}
            onclick={() => (isIncome = !isIncome)}
            aria-pressed={isIncome}
          >
            {isIncome ? 'money in' : 'money out'}
          </button>
        </div>

        <label class="field-label" for="ae-merchant">Merchant</label>
        <input id="ae-merchant" bind:value={merchant} placeholder="Where did it go?" />

        <div class="field-label">Category</div>
        <div class="chips">
          {#each shownCategories as c (c.id)}
            <button
              type="button"
              class="chip-btn"
              class:on={categoryId === c.id}
              style={c.color && categoryId === c.id
                ? `background:${c.color}; color:var(--surface-1); border-color:${c.color}`
                : c.color
                  ? tint(c.color)
                  : ''}
              onclick={() => (categoryId = categoryId === c.id ? null : c.id)}
            >
              {c.icon ?? ''}
              {c.name}
            </button>
          {/each}
          {#if !showAllCategories && categories.length > QUICK}
            <button type="button" class="chip-btn more" onclick={() => (showAllCategories = true)}>
              More…
            </button>
          {/if}
        </div>

        <div class="two">
          <div>
            <label class="field-label" for="ae-date">Date</label>
            <input id="ae-date" type="date" bind:value={date} />
          </div>
          <div>
            <label class="field-label" for="ae-account">Account</label>
            {#if accounts.length}
              <select id="ae-account" bind:value={accountId}>
                {#each accounts as a (a.id)}
                  <option value={a.id}>{a.name}</option>
                {/each}
              </select>
            {:else}
              <!-- Nothing to choose from yet. Rather than a disabled form, say
                   what will happen: the first entry makes the account. -->
              <div class="will-create">
                <Icon name="plus" size={15} /> A “Cash” account will be created
              </div>
            {/if}
          </div>
        </div>

        <label class="field-label" for="ae-note">Note <span class="muted">optional</span></label>
        <input id="ae-note" bind:value={note} placeholder="Anything worth remembering" />

        {#if saveError}<p class="error">{saveError}</p>{/if}

        <div class="actions">
          <button class="primary" type="button" onclick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onclick={onclose} disabled={saving}>Cancel</button>
        </div>
        <p class="hint muted">{keys.combo('Enter')} to save · Esc to close</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop-hit {
    position: fixed;
    inset: 0;
    z-index: 60;
    border: 0;
    border-radius: 0;
    padding: 0;
    min-height: 0;
    background: color-mix(in srgb, var(--neutral-900) 50%, transparent);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 61;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    /* The scrim behind catches the clicks; this layer only positions the
       dialog, so it must not swallow them. */
    pointer-events: none;
  }

  /* The dialog scrolls itself. This layer used to, but with pointer-events
     off a phone's swipe never reached it, and centring a dialog taller than
     the screen pushed its top out of reach too -- so "More…" categories left
     Date, Account and Save below the fold for good. dvh, not vh: iOS counts
     its toolbars in vh. */
  .dialog {
    pointer-events: auto;
    max-height: calc(100dvh - 2 * var(--space-4));
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .dialog {
    width: min(440px, 100%);
    background: var(--surface-2);
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-lg);
    padding: var(--space-5);
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .head h2 {
    margin: 0 0 2px;
    font-size: 26px;
  }

  .head p {
    margin: 0;
    font-size: 13.5px;
    max-width: 34ch;
  }

  .close {
    min-height: 34px;
    padding: 0 var(--space-2);
    flex: none;
  }

  .body {
    background: var(--surface-1);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
  }

  .field-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    margin: var(--space-4) 0 var(--space-1);
  }

  .body > .field-label:first-child {
    margin-top: 0;
  }

  /* The amount is the headline of this dialog and is sized like one. */
  .amount-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    border-bottom: 2px solid var(--accent);
    padding-bottom: var(--space-2);
  }

  .currency {
    font-family: var(--font-heading);
    font-weight: var(--font-heading-weight);
    font-size: 30px;
    color: var(--text-muted);
  }

  input.amount {
    flex: 1;
    border: 0;
    background: transparent;
    padding: 0;
    min-height: 0;
    border-radius: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-heading-weight);
    font-size: 40px;
    font-variant-numeric: tabular-nums;
  }

  input.amount:focus {
    box-shadow: none;
  }

  /* Direction is a toggle rather than a sign you have to remember to type: the
     app stores money out as negative, and nobody should have to know that. */
  .dir {
    flex: none;
    min-height: 32px;
    padding: 0 var(--space-3);
    font-size: 12.5px;
    font-weight: 600;
    background: color-mix(in srgb, var(--money-out) 16%, transparent);
    border-color: transparent;
    color: var(--money-out);
  }

  .dir.income {
    background: color-mix(in srgb, var(--money-in) 18%, transparent);
    color: var(--money-in);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .chip-btn {
    min-height: 32px;
    padding: 0 14px;
    font-size: 13.5px;
    font-weight: 600;
    border-color: var(--border);
    background: var(--surface-2);
    color: var(--text-secondary);
  }

  .chip-btn.more {
    font-weight: 400;
  }

  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .two .field-label {
    margin-top: var(--space-4);
  }

  .will-create {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 42px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-pill);
    background: var(--accent-2-soft);
    color: var(--good);
    font-size: 13px;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }

  .actions .primary {
    flex: 1;
  }

  .hint {
    text-align: center;
    font-size: 12px;
    margin: var(--space-2) 0 0;
  }

  @media (max-width: 480px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
