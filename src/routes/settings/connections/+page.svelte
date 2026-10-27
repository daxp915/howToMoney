<script lang="ts">
  import { enhance } from '$app/forms';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import Tag from '$lib/components/ui/Tag.svelte';
  import SetupTokenField from '$lib/components/SetupTokenField.svelte';
  import { SIMPLEFIN_URL } from '$lib/simplefin';
  import { drillHref } from '$lib/drill';
  import { usd } from '$lib/money';
  import { sync } from '$lib/sync.svelte';
  import { invalidateAll } from '$app/navigation';
  import { openPlaidLink } from '$lib/plaidLink';

  /**
   * Connections: the SimpleFIN banks in one list,
   * one `connectionIssues()` names tagged "Needs attention" with a card that sends you to
   * SimpleFIN to fix it and then syncs; "Add a bank" (at SimpleFIN) and "Use a
   * new setup token" underneath; then files.
   *
   * Bank sign-ins happen at SimpleFIN, never here: a broken bank is fixed
   * there, and "Sync now" pulls the fix back in through the sync job.
   */
  let { data, form } = $props();

  let tokenOpen = $state(false);
  let token = $state('');
  let busy = $state(false);
  let disconnecting = $state(false);

  $effect(() => {
    if (form?.token) token = form.token;
    if (form?.tokenError) tokenOpen = true;
  });

  // With Plaid on, a new household starts from "Connect a bank"; the SimpleFIN
  // token form is one click away under Add more rather than filling the page.
  const showToken = $derived(tokenOpen || (!data.credential && !data.plaidEnabled));

  /** Which Link is open: 'new', a Plaid item id (Reconnect), or none. */
  let linking = $state<string | null>(null);
  let plaidError = $state<string | null>(null);
  let removing = $state<string | null>(null);

  async function connectPlaid(itemId?: string) {
    linking = itemId ?? 'new';
    plaidError = null;
    try {
      if (await openPlaidLink(itemId)) {
        await invalidateAll();
        sync.start();
      }
    } catch (e) {
      plaidError = e instanceof Error ? e.message : String(e);
    } finally {
      linking = null;
    }
  }
  const plaidItemFor = (bank: string | null) => data.plaid.find((p) => p.name === bank);
  const since = (d: Date | string | null) =>
    d ? ` since ${new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';

  const when = (d: Date | string | null) => {
    if (!d) return 'not synced yet';
    const x = new Date(d);
    const today = new Date().toDateString() === x.toDateString();
    return today
      ? x.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter((w) => /^[a-z0-9]/i.test(w))
      .slice(0, 3)
      .map((w) => w[0].toUpperCase())
      .join('');
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /** A new connection syncs straight away: that is the point of adding it. */
  const claiming = () => {
    busy = true;
    return async ({ result, update }: { result: { type: string }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      busy = false;
      if (result.type === 'success') {
        token = '';
        tokenOpen = false;
        sync.start();
      }
    };
  };
</script>

<svelte:head><title>Connections · HTMFD</title></svelte:head>

<div class="conn">
  <header class="head">
    <div>
      <h1>Connections</h1>
      <p class="sub">
        Syncs every 6 hours.{#if data.lastSync}{' '}Last full sync {when(data.lastSync.finishedAt ?? data.lastSync.startedAt)}.{/if}
      </p>
    </div>
    <div class="acts">
      <Btn variant="secondary" href="/settings/import">Import a file</Btn>
      {#if data.plaidEnabled}
        <Btn variant="primary" disabled={linking !== null} onclick={() => connectPlaid()}
          >{linking === 'new' ? 'Opening…' : 'Connect a bank'}</Btn
        >
      {:else}
        <a class="btn-ext" href={SIMPLEFIN_URL} target="_blank" rel="noreferrer noopener">Add a bank ↗</a>
      {/if}
    </div>
  </header>

  {#if plaidError}<p class="note bad">{plaidError}</p>{/if}
  {#if form?.plaidRemoved}<p class="note good">Disconnected. Its accounts and history stay, and stop updating.</p>{/if}

  {#if form?.connected}
    <p class="note good">
      <b>Connected.</b> SimpleFIN answered for {form.connected.join(', ')}.{sync.running ? ' Syncing now…' : ''}
    </p>
  {/if}
  {#if sync.error}<p class="note bad">{sync.error}</p>{/if}

  {#if data.banks.length}
    <Section label="SimpleFIN">
      <Card>
        {#each data.banks as b (b.name)}
          <div class="row">
            <span class="logo">{initials(b.name)}</span>
            <span class="who">
              <span class="nm">{b.name}</span>
              <span class="meta"
                >{plural(b.accounts.length, 'account')} · {b.stale ? 'not updating' : `synced ${when(b.syncedAt)}`}</span
              >
            </span>
            {#if b.stale}<Tag tone="watch" size="sm">Needs attention</Tag>{/if}
          </div>
        {/each}
      </Card>
    </Section>
  {/if}

  {#if data.plaid.length}
    <!-- One row per bank connected through Plaid; each signs in on its own. -->
    <Section label="Connected banks">
      <Card>
        {#each data.plaid as p (p.id)}
          <div class="row">
            <span class="logo">{initials(p.name)}</span>
            <span class="who">
              <span class="nm">{p.name}</span>
              <span class="meta"
                >{plural(p.accounts, 'account')} · {p.errorCode ? 'not updating' : `synced ${when(p.syncedAt)}`}</span
              >
            </span>
            {#if p.errorCode}
              <button type="button" class="pill soft" disabled={linking !== null} onclick={() => connectPlaid(p.id)}
                >{linking === p.id ? 'Opening…' : 'Reconnect'}</button
              >
            {/if}
            {#if removing === p.id}
              <form
                class="confirm"
                method="POST"
                action="?/plaidRemove"
                use:enhance={() => async ({ update }) => {
                  await update();
                  removing = null;
                }}
              >
                <input type="hidden" name="id" value={p.id} />
                <Btn variant="secondary" size="sm" type="submit">Disconnect</Btn>
                <Btn variant="ghost" size="sm" onclick={() => (removing = null)}>Cancel</Btn>
              </form>
            {:else}
              <button type="button" class="quiet" aria-label={`Disconnect ${p.name}`} onclick={() => (removing = p.id)}
                >Disconnect</button
              >
            {/if}
          </div>
        {/each}
      </Card>
    </Section>
  {/if}

  <!-- Every problem connectionIssues() found, with the fix where it happens. -->
  {#each data.issues as x (x.key)}
    <Card pad="body">
      <div class="fix" role="alert">
        <span class="fix-t">{x.title}<span class="fix-since">{since(x.since)}</span></span>
        <span class="fix-p">{x.detail}</span>
        <div class="fix-acts">
          {#if x.fix === 'simplefin'}
            <a class="pill soft" href={SIMPLEFIN_URL} target="_blank" rel="noreferrer noopener">Fix at SimpleFIN ↗</a>
          {:else if x.fix === 'token'}
            <button type="button" class="pill soft" onclick={() => (tokenOpen = true)}>Use a new setup token</button>
          {:else if x.fix === 'plaid' && plaidItemFor(x.bank)}
            {@const item = plaidItemFor(x.bank)!}
            <button type="button" class="pill soft" disabled={linking !== null} onclick={() => connectPlaid(item.id)}
              >{linking === item.id ? 'Opening…' : 'Reconnect'}</button
            >
          {/if}
          {#if x.fix !== 'token' && x.fix !== 'plaid'}
            <button type="button" class="pill outline" disabled={sync.running} onclick={() => sync.start()}
              >{sync.running ? 'Syncing…' : 'Sync now'}</button
            >
          {/if}
        </div>
      </div>
    </Card>
  {/each}

  {#if showToken}
    <Section label={data.credential ? 'New setup token' : 'Connect through SimpleFIN'}>
      <Card pad="body">
        <form class="claim" method="POST" action="?/claim" use:enhance={claiming}>
          <p class="p">
            {#if data.credential}
              Paste the token from your new SimpleFIN connection. It replaces the current one; your history stays.
            {:else}
              Add your banks at <a href={SIMPLEFIN_URL} target="_blank" rel="noreferrer noopener">SimpleFIN ↗</a>, create a
              setup token, and paste it here.
            {/if}
          </p>
          <SetupTokenField bind:value={token} error={form?.tokenError ?? null} autofocus={tokenOpen} />
          <div class="claim-acts">
            <Btn variant="primary" type="submit" disabled={busy || !token.trim()}>{busy ? 'Connecting…' : 'Connect'}</Btn>
            {#if data.credential}<Btn variant="ghost" onclick={() => (tokenOpen = false)}>Cancel</Btn>{/if}
          </div>
        </form>
      </Card>
    </Section>
  {/if}

  {#if data.credential || data.plaidEnabled}
    <Section label="Add more">
      <Card>
        {#if data.plaidEnabled}
          <!-- The header has this button on desktop; a phone hides the header
               buttons, so this row is its way in there. -->
          <button type="button" class="row link-row phone-only" disabled={linking !== null} onclick={() => connectPlaid()}>
            <span class="who"
              ><span class="nm">Connect a bank</span><span class="meta">Sign in at your bank through Plaid. Read-only.</span></span
            >
            <span class="go accent" aria-hidden="true">›</span>
          </button>
        {/if}
        {#if data.credential}
          <a
            class="row link-row"
            class:phone-only={!data.plaidEnabled}
            href={SIMPLEFIN_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            <span class="who"
              ><span class="nm">Add a bank at SimpleFIN</span><span class="meta">It appears on the next sync.</span></span
            >
            <span class="go accent" aria-hidden="true">↗</span>
          </a>
        {/if}
        <button type="button" class="row link-row" aria-expanded={tokenOpen} onclick={() => (tokenOpen = !tokenOpen)}>
          <span class="who">
            {#if data.credential}
              <span class="nm">Use a new setup token</span><span class="meta">Only if you made a new SimpleFIN connection</span>
            {:else}
              <span class="nm">Use SimpleFIN instead</span><span class="meta">Paste a setup token from your SimpleFIN Bridge</span>
            {/if}
          </span>
          <span class="go" aria-hidden="true">›</span>
        </button>
      </Card>
    </Section>
  {/if}

  {#if data.manual}
    <Section label="Entered by hand">
      <!-- One row per account, each opening its transactions: what is in it
           and where it comes from, said on the row itself. -->
      <Card>
        {#each data.manual.accounts as a (a.id)}
          <a class="row link-row" href={drillHref({ account: a.id })}>
            <span class="logo">✎</span>
            <span class="who"
              ><span class="nm">{a.name}</span><span class="meta"
                >Cash spending you log with + Cash in Activity. No bank feeds this one.</span
              ></span
            >
            <span class="bal figure"><span class="amt">{usd(a.balance)}</span></span>
            <span class="go" aria-hidden="true">›</span>
          </a>
        {/each}
      </Card>
    </Section>
  {/if}

  <Section label="Files">
    <Card>
      <a class="row link-row" href="/settings/import">
        <span class="who">
          {#if data.lastImport}
            <span class="nm">Last import: {data.lastImport.filename}</span>
            <span class="meta"
              >{new Date(data.lastImport.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {data
                .lastImport.imported} transactions{data.lastImport.duplicates ? `, ${data.lastImport.duplicates} duplicates skipped` : ''}</span
            >
          {:else}
            <span class="nm">Import a file</span>
            <span class="meta">CSV, OFX or QFX from your bank's website</span>
          {/if}
        </span>
        <span class="go" aria-hidden="true">›</span>
      </a>
    </Card>
  </Section>

  {#if data.credential}
    <div class="disc">
      {#if disconnecting}
        <form method="POST" action="?/disconnect" use:enhance={() => async ({ update }) => { await update(); disconnecting = false; }}>
          <span>Stop syncing? Accounts and history stay.</span>
          <Btn variant="secondary" size="sm" type="submit">Disconnect</Btn>
          <Btn variant="ghost" size="sm" onclick={() => (disconnecting = false)}>Cancel</Btn>
        </form>
      {:else}
        <button type="button" class="quiet" onclick={() => (disconnecting = true)}>Disconnect SimpleFIN</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .conn {
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 720px;
    line-height: normal;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
  }

  h1 {
    margin: 0;
  }

  .sub {
    margin: 6px 0 0;
    font-size: 14px;
    color: var(--ink-2);
  }

  .acts {
    display: flex;
    gap: 8px;
  }

  .btn-ext {
    display: inline-flex;
    align-items: center;
    padding: 12px 20px;
    border-radius: var(--r-pill);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 16px;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
  }

  .btn-ext:hover {
    filter: brightness(1.08);
  }

  .note {
    margin: 0;
    padding: 12px 16px;
    border-radius: var(--r-field);
    font-size: 14px;
  }

  .note.good {
    background: var(--ok-soft);
    color: var(--ok-text);
  }

  .note.bad {
    background: var(--over-soft);
    color: var(--over-text);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    margin: 0;
    padding: 13px 16px;
    border: 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    background: none;
    font: inherit;
    color: var(--ink);
    text-align: left;
    text-decoration: none;
    min-height: 0;
  }

  .row:first-child {
    border-top: 0;
  }

  .link-row {
    cursor: pointer;
  }

  .link-row:hover {
    background: var(--pill);
  }

  .logo {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--pill);
    color: var(--ink-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 600;
    flex: 0 0 auto;
  }

  .who {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .nm {
    font-size: 16px;
  }

  .meta {
    font-size: 13px;
    color: var(--ink-3);
  }

  .go {
    color: var(--ink-3);
  }

  .bal {
    flex: none;
    font-size: 16px;
  }

  .go.accent {
    color: var(--accent-text);
    font-weight: 500;
  }

  .fix {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .fix-t {
    font-size: 17px;
    font-weight: 500;
  }

  .fix-since {
    font-weight: 400;
    color: var(--ink-3);
  }

  .fix-p {
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink-2);
  }

  .fix-acts {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    min-height: 0;
    margin: 0;
    padding: 11px 16px;
    border: 0;
    border-radius: var(--r-pill);
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    line-height: normal;
    text-decoration: none;
    cursor: pointer;
  }

  .pill.soft {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .pill.outline {
    padding: 10px 16px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink);
  }

  .pill:hover:not(:disabled) {
    filter: brightness(0.97);
  }

  .pill:disabled {
    color: var(--ink-3);
    cursor: default;
  }

  .claim {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .p {
    margin: 0;
    font-size: 15px;
    line-height: 1.5;
    color: var(--ink-2);
  }

  .claim-acts {
    display: flex;
    gap: 8px;
  }

  .disc form {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--ink-2);
  }

  .confirm {
    display: flex;
    gap: 6px;
    flex: none;
  }

  .row .quiet {
    flex: none;
  }

  .quiet {
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-3);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }

  @media (min-width: 761px) {
    .phone-only {
      display: none;
    }

    .phone-only + .row {
      border-top: 0;
    }
  }

  @media (max-width: 760px) {
    /* The phone mock has no header buttons: Add more carries them. */
    .acts,
    .sub {
      display: none;
    }
  }
</style>
