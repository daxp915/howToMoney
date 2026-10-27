<script lang="ts">
  import { enhance } from '$app/forms';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import SetupTokenField from '$lib/components/SetupTokenField.svelte';
  import { usd } from '$lib/money';
  import { SIMPLEFIN_URL } from '$lib/simplefin';
  import { goto } from '$app/navigation';
  import { openPlaidLink } from '$lib/plaidLink';

  /**
   * Setup: from install to the first number in four steps. The
   * welcome shows the real Home hero rather than an illustration; then
   * connect, read the history (leaving is fine, it keeps going), and accept a
   * budget proposed from three months of your own spending -- or start from
   * zero. Bank sign-ins happen at SimpleFIN, never here.
   */
  let { data, form } = $props();

  let busy = $state(false);
  // "Import a file instead" submits through the token form; that is not
  // connecting, so it does not say so.
  const pending = ({ submitter }: { submitter?: HTMLElement | null } = {}) => {
    busy = !submitter?.hasAttribute('formaction');
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      busy = false;
    };
  };

  // Step 2: the pasted token; a rejected one comes back still in the field.
  let token = $state('');
  $effect(() => {
    if (form?.token) token = form.token;
  });

  // Step 2 with Plaid on: Link first, SimpleFIN one tap away. A token that
  // came back rejected means the person chose SimpleFIN, so it stays open.
  let useSimpleFin = $state(false);
  const simpleFin = $derived(!data.plaidEnabled || useSimpleFin || !!form?.tokenError);
  let linking = $state(false);
  let linkError = $state<string | null>(null);
  async function connectPlaid() {
    linking = true;
    linkError = null;
    try {
      if (await openPlaidLink()) await goto('?step=3', { invalidateAll: true });
    } catch (e) {
      linkError = e instanceof Error ? e.message : String(e);
    } finally {
      linking = false;
    }
  }

  // Step 4: the proposal, editable before it is saved.
  let amounts = $state<Record<string, string>>({});
  $effect(() => {
    if (data.proposal) amounts = Object.fromEntries(data.proposal.lines.map((l) => [l.id, String(l.amount)]));
  });
  let showAll = $state(false);
  const total = $derived(Object.values(amounts).reduce((s, v) => s + (Number(v.replace(/[$,\s]/g, '')) || 0), 0));
  const shownLines = $derived(data.proposal ? (showAll ? data.proposal.lines : data.proposal.lines.slice(0, 6)) : []);
</script>

<svelte:head><title>Set up · HTMFD</title></svelte:head>

<main class="wel">
  {#if data.step > 1}
    <div class="progress" aria-label="Step {data.step - 1} of 3">
      {#each [2, 3, 4] as s (s)}<span class:on={data.step >= s}></span>{/each}
      <span></span>
    </div>
  {/if}

  {#if data.step === 1}
    <span class="mark">HTMFD</span>
    <!-- The promise is the product: a real Home hero, tilted. -->
    <div class="tilt" aria-hidden="true">
      <Card pad="hero">
        <div class="demo-hero"><b>$2,769</b> <span>left</span></div>
        <div class="demo-sub">out of <b>$4,615</b> budgeted</div>
        <svg viewBox="0 0 300 70" preserveAspectRatio="none">
          <line x1="0" y1="66" x2="300" y2="6" class="pace" />
          <polyline points="0,66 40,60 80,57 120,51" class="mine" />
        </svg>
        <span class="demo-tag">$37 under</span>
      </Card>
    </div>
    <h1>One number that says whether you're okay this month.</h1>
    <p class="lede">Connect your bank. HTMFD files every transaction and keeps that number up to date.</p>
    <div class="foot">
      <Btn variant="primary" full href="?step=2">Connect a bank</Btn>
      <form method="POST" action="?/importInstead">
        <button type="submit" class="plain">Import a file instead</button>
      </form>
      <p class="fine">Read-only access. HTMFD can't move money.</p>
    </div>
  {:else if data.step === 2 && !simpleFin}
    <!-- Plaid: the bank is chosen and signed into in Plaid's own window. -->
    <div class="fill">
      <div class="intro">
        <h1>Connect your bank</h1>
        <p class="lede">
          Pick your bank and sign in there, in Plaid's secure window. HTMFD gets read-only access and never sees your bank
          password.
        </p>
      </div>
      <Card>
        <ol class="numbered">
          <li><span class="n">1</span><span class="t">Find your bank</span></li>
          <li><span class="n">2</span><span class="t">Sign in the way you do in its app</span></li>
          <li><span class="n">3</span><span class="t">Choose which accounts to share</span></li>
        </ol>
      </Card>
      {#if linkError}<p class="err">{linkError}</p>{/if}
      <div class="foot pinned">
        {#if data.connected}
          <Btn variant="primary" full href="?step=3">Continue</Btn>
        {:else}
          <Btn variant="primary" full disabled={linking} onclick={connectPlaid}>{linking ? 'Opening…' : 'Connect a bank'}</Btn>
        {/if}
        <button type="button" class="plain" onclick={() => (useSimpleFin = true)}>Use a SimpleFIN token instead</button>
        <form method="POST" action="?/importInstead">
          <button type="submit" class="plain">Import a file instead</button>
        </form>
        <p class="fine">Read-only access. HTMFD can't move money.</p>
      </div>
    </div>
  {:else if data.step === 2}
    <!-- : SimpleFIN owns choosing banks, so this step explains its
         three steps and takes the token. Connect waits for one. -->
    <form method="POST" action="?/claim" use:enhance={pending} class="fill">
      <div class="intro">
        <h1>Connect through SimpleFIN</h1>
        <p class="lede">
          HTMFD reads your banks through SimpleFIN Bridge. You choose the banks there, and HTMFD never sees your bank login.
        </p>
      </div>
      <Card>
        <ol class="numbered">
          <li>
            <span class="n">1</span><span class="t">Add your banks at SimpleFIN</span>
            <a class="open" href={SIMPLEFIN_URL} target="_blank" rel="noreferrer noopener">Open ↗</a>
          </li>
          <li><span class="n">2</span><span class="t">Create a setup token and copy it</span></li>
          <li><span class="n">3</span><span class="t">Paste it below</span></li>
        </ol>
      </Card>
      <SetupTokenField bind:value={token} error={form?.tokenError ?? null} />
      <div class="foot pinned">
        {#if data.connected && !token.trim()}
          <Btn variant="primary" full href="?step=3">Continue</Btn>
        {:else}
          <Btn variant="primary" full type="submit" disabled={busy || !token.trim()}>{busy ? 'Connecting…' : 'Connect'}</Btn>
        {/if}
        <button type="submit" class="plain" formaction="?/importInstead" formnovalidate>Import a file instead</button>
        <p class="fine">Read-only access. HTMFD can't move money.</p>
      </div>
    </form>
  {:else if data.step === 3}
    <h1>Reading your history</h1>
    <p class="lede">
      {data.viaPlaid ? 'Up to two years, as far back as your bank shares.' : 'Up to 89 days, which is all SimpleFIN keeps.'}
    </p>
    <div class="bar" class:running={busy}><span style="width: {form?.synced !== undefined ? 100 : busy ? 60 : 4}%"></span></div>
    {#if form?.synced !== undefined}
      <p class="meta">{form.inserted} transactions from {form.synced} accounts</p>
    {/if}
    {#if data.accounts.length}
      <Section label="Accounts found">
        <Card>
          {#each data.accounts as a (a.id)}
            <div class="arow">
              <span>{a.name}{a.last4 ? ` ··${a.last4}` : ''}</span>
              {#if a.synced || form?.synced !== undefined}<span class="ok">✓</span>{:else if busy}<span class="spin"></span>{/if}
            </div>
          {/each}
        </Card>
      </Section>
    {/if}
    {#if form?.message}<p class="err">{form.message}</p>{/if}
    <div class="foot">
      {#if form?.synced !== undefined || data.reached >= 4}
        <Btn variant="primary" full href="?step=4">Next</Btn>
      {:else}
        <form method="POST" action="?/sync" use:enhance={pending}>
          <Btn variant="primary" full type="submit" disabled={busy}>{busy ? 'Reading…' : 'Read my history'}</Btn>
        </form>
      {/if}
      <p class="fine">You can leave this screen. It keeps going.</p>
    </div>
  {:else if data.proposal && !data.proposal.lines.length}
    <!-- Nothing categorized to propose from yet (a bank with little history,
         or categorizing still running). "$0 a month" with "Use this budget"
         read as a broken screen to a new person, so say what happens instead. -->
    <h1>Your budget comes next</h1>
    <p class="lede">
      There isn't enough spending in your history yet to suggest one. Plan can build it from your history once a few weeks
      of spending are in, or you can set one category at a time.
    </p>
    <form method="POST" action="?/finish" class="foot">
      <Btn variant="primary" full type="submit">Go to Home</Btn>
    </form>
  {:else if data.proposal}
    <h1>Here's a starting budget</h1>
    <p class="lede">Based on what you spent in the last 3 months.</p>
    <form method="POST" action="?/budget" use:enhance={pending} class="budget">
      <Card pad="body">
        <div class="total">
          <b>{usd(total, { cents: false })}</b> <span>a month</span>
        </div>
        {#if data.proposal.income}<div class="meta">of {usd(data.proposal.income, { cents: false })} typical income</div>{/if}
      </Card>
      <Card>
        {#each shownLines as l (l.id)}
          <label class="line">
            <span class="emoji" aria-hidden="true">{l.icon ?? '•'}</span>
            <span class="nm">{l.name}</span>
            <span class="money-in"
              ><span aria-hidden="true">$</span><input inputmode="decimal" name="b:{l.id}" bind:value={amounts[l.id]} aria-label="{l.name} budget" /></span
            >
          </label>
        {/each}
        {#if !showAll}
          {#each data.proposal.lines.slice(6) as l (l.id)}<input type="hidden" name="b:{l.id}" value={amounts[l.id]} />{/each}
        {/if}
      </Card>
      {#if data.proposal.lines.length > 6 && !showAll}
        <button type="button" class="plain small" onclick={() => (showAll = true)}
          >+ {data.proposal.lines.length - 6} more categories · change anything later in Plan</button
        >
      {/if}
      <div class="foot">
        <Btn variant="primary" full type="submit" disabled={busy}>Use this budget</Btn>
      </div>
    </form>
    <form method="POST" action="?/finish" class="center">
      <button type="submit" class="plain">Start from zero</button>
    </form>
  {/if}
</main>

<style>
  .wel {
    max-width: 480px;
    min-height: 100dvh;
    margin: 0 auto;
    padding: 40px 20px 48px;
    display: flex;
    flex-direction: column;
    gap: 22px;
    line-height: normal;
  }

  /* Step 2: the token form fills the screen so its buttons sit at
     the bottom, as on the phone mock. */
  .fill {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .intro .lede {
    margin: 0;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .foot.pinned {
    margin-top: auto;
    gap: 6px;
  }

  .foot.pinned .plain {
    width: 100%;
    padding: 13px;
  }

  .foot.pinned .plain:hover {
    text-decoration: none;
    background: var(--pill);
    border-radius: var(--r-pill);
  }

  .numbered {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .numbered li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    border-top: 1px solid var(--line);
    font-size: 16px;
  }

  .numbered li:first-child {
    border-top: 0;
  }

  .numbered .n {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--pill);
    color: var(--ink-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 600;
  }

  .numbered .t {
    flex: 1 1 auto;
  }

  .open {
    font-size: 15px;
    font-weight: 500;
    color: var(--accent-text);
    white-space: nowrap;
  }

  .progress {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }

  .progress span {
    height: 4px;
    border-radius: 2px;
    background: var(--track);
  }

  .progress span.on {
    background: var(--ink);
  }

  .mark {
    font-size: 18px;
    font-weight: 600;
  }

  .tilt {
    transform: rotate(-2deg);
    margin: 8px 6px;
    position: relative;
  }

  .demo-hero {
    text-align: center;
    font-size: 30px;
  }

  .demo-hero b,
  .demo-sub b,
  .total b {
    font-weight: 500;
  }

  .demo-hero span {
    color: var(--ink-2);
  }

  .demo-sub {
    text-align: center;
    font-size: 13px;
    color: var(--ink-2);
  }

  svg {
    width: 100%;
    height: 70px;
    margin-top: 12px;
  }

  .pace {
    stroke: var(--ink-3);
    stroke-dasharray: 4 5;
  }

  .mine {
    fill: none;
    stroke: var(--accent);
    stroke-width: 3;
  }

  .demo-tag {
    position: absolute;
    left: 44%;
    bottom: 36px;
    padding: 3px 8px;
    border-radius: var(--r-pill);
    background: var(--ok-soft);
    color: var(--ok-text);
    font-size: 12px;
    font-weight: 600;
  }

  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 500;
    letter-spacing: -0.01em;
    line-height: 1.15;
  }

  .lede {
    margin: -10px 0 0;
    font-size: 15px;
    color: var(--ink-2);
  }

  .foot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
  }

  .foot form {
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .plain {
    min-height: 0;
    padding: 6px;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
  }

  .plain:hover {
    background: none;
    text-decoration: underline;
  }

  .plain.small {
    align-self: flex-start;
    font-size: 13px;
    font-weight: 400;
    color: var(--ink-2);
  }

  .fine,
  .meta {
    margin: 0;
    font-size: 13px;
    color: var(--ink-3);
  }

  .err {
    margin: 12px 0 0;
    font-size: 14px;
    color: var(--over-text);
  }

  .bar {
    height: 6px;
    border-radius: 3px;
    background: var(--track);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 2s ease-out;
  }

  .arow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-top: 1px solid var(--line);
    font-size: 15px;
  }

  .arow:first-child {
    border-top: 0;
  }

  .ok {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--ok);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
  }

  .spin {
    width: 16px;
    height: 16px;
    border: 2px solid var(--line);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .budget {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .total {
    font-size: 32px;
    letter-spacing: var(--ls-hero);
  }

  .total span {
    font-size: 16px;
    color: var(--ink-2);
    letter-spacing: 0;
  }

  .line {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) 96px;
    gap: 12px;
    align-items: center;
    padding: 8px 16px;
    border-top: 1px solid var(--line);
  }

  .line:first-child {
    border-top: 0;
  }

  .emoji {
    font-size: 18px;
  }

  .nm {
    font-size: 16px;
  }

  .center {
    display: flex;
    justify-content: center;
    margin-top: -10px;
  }

  .money-in {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-input-amount);
    background: var(--surface);
    font-weight: 500;
  }

  .money-in:focus-within {
    border-color: var(--accent);
  }

  .line input {
    min-height: 0;
    padding: 8px 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    text-align: right;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
</style>
