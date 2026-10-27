<script lang="ts">
  import { enhance } from '$app/forms';
  import { fullDate } from '$lib/format';
  import Button from '$lib/components/Button.svelte';
  import Tag from '$lib/components/Tag.svelte';

  let { data, form } = $props();
  let showSecret = $state(false);
  let confirmingDisable = $state(false);
  let confirmingDelete = $state(false);

  const others = $derived(data.sessions.filter((s) => !s.me).length);
</script>

<svelte:head><title>Security · HTMFD</title></svelte:head>

<div class="hf-page">
  <header>
    <h1 class="hf-title">Security</h1>
    <p class="hf-lede">{data.email}</p>
  </header>

  {#if data.mustChangePassword}
    <p class="note warn">
      <b>Set your own password to continue.</b> This account is still using the password an admin
      typed for it, so two people know it. The rest of the app is out of reach until you change it.
    </p>
  {/if}

  {#if form?.message}<p class="note warn">{form.message}</p>{/if}
  {#if form?.passwordChanged}
    <p class="note good">
      Password changed.{#if form.alsoSignedOut}
        Signed out {form.alsoSignedOut} other session{form.alsoSignedOut === 1 ? '' : 's'}.
      {/if}
    </p>
  {/if}
  {#if form?.confirmed}<p class="note good">Two-factor is on.</p>{/if}
  {#if form?.disabled}<p class="note good">Two-factor is off.</p>{/if}
  {#if form?.signedOut !== undefined}
    <p class="note good">Signed out {form.signedOut} other session{form.signedOut === 1 ? '' : 's'}.</p>
  {/if}

  <div class="cols">
    <section class="box stack">
      <h2 class="title">Password</h2>
      <p class="body">
        {data.passwordChangedAt ? `Last changed ${fullDate(data.passwordChangedAt)}.` : 'Never changed.'}
        Changing it signs out every other session — this one stays.
      </p>
      <form class="stack" method="POST" action="?/changePassword" use:enhance>
        <label class="field">
          <span>Current password</span>
          <input name="current" type="password" autocomplete="current-password" required />
        </label>
        <label class="field">
          <span>New password</span>
          <input name="next" type="password" autocomplete="new-password" minlength={data.minPassword} required />
          <small>At least {data.minPassword} characters. A long passphrase beats a short one with symbols.</small>
        </label>
        <label class="field">
          <span>New password again</span>
          <input name="confirm" type="password" autocomplete="new-password" minlength={data.minPassword} required />
        </label>
        <div class="submit"><Button variant="primary" type="submit">Change password</Button></div>
      </form>
    </section>

    <div class="col">
      <section class="box stack tight">
        <div class="head center">
          <h2 class="title">Two-factor</h2>
          {#if data.enrolled}<Tag tone="good">On</Tag>{:else}<Tag tone="warn">Off</Tag>{/if}
        </div>

        {#if data.enrolled}
          <p class="body">
            An authenticator code is asked for at sign-in, on top of your password — on since
            {fullDate(data.enrolledAt!)}.
          </p>
          {#if confirmingDisable}
            <form class="stack" method="POST" action="?/disable" use:enhance>
              <label class="field">
                <span>Your password, to turn it off</span>
                <input name="password" type="password" autocomplete="current-password" required />
              </label>
              <div class="row">
                <Button type="submit">Turn off</Button>
                <Button variant="small" onclick={() => (confirmingDisable = false)}>Cancel</Button>
              </div>
            </form>
          {:else}
            <div><Button onclick={() => (confirmingDisable = true)}>Turn off</Button></div>
          {/if}
        {:else if data.pending}
          <p class="body">Scan this with your authenticator app, then enter the six-digit code it shows.</p>
          <div class="enroll">
            <div class="qr">{@html data.pending.svg}</div>
            <div class="stack grow">
              <form class="stack" method="POST" action="?/confirm" use:enhance>
                <label class="field">
                  <span>Code from your app</span>
                  <input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" required />
                </label>
                <div><Button variant="primary" type="submit">Verify and turn on</Button></div>
              </form>
              {#if showSecret}
                <code class="secret">{data.pending.secret}</code>
                <p class="fine">
                  Enter this as a time-based key. Anyone with it can make your codes — keep it only in
                  the authenticator app.
                </p>
              {:else}
                <div><Button variant="small" onclick={() => (showSecret = true)}>Can’t scan it? Show the key</Button></div>
              {/if}
            </div>
          </div>
          <p class="fine">Nothing changes until a code matches, so a half-finished setup can’t lock you out.</p>
        {:else}
          <p class="body">
            Your password is the only thing the app checks. One extra step at sign-in closes that gap.
          </p>
          <form method="POST" action="?/begin" use:enhance>
            <Button variant="primary" type="submit">Set up authenticator</Button>
          </form>
        {/if}
      </section>

      <section class="box sessions">
        <div class="head">
          <h2 class="title">Signed in</h2>
          <span class="meta">{data.sessions.length} session{data.sessions.length === 1 ? '' : 's'}</span>
        </div>
        {#each data.sessions as s, i (i)}
          <div class="session">
            <span class="avatar">{s.initials}</span>
            <div class="grow">
              <div class="name">{s.name}</div>
              <div class="meta">{s.meta}</div>
            </div>
            {#if s.me}<Tag tone="good" size="sm">This one</Tag>{/if}
          </div>
        {/each}
        <form class="signout" method="POST" action="?/signOutOthers" use:enhance>
          <Button type="submit" disabled={others === 0}>Sign out the others</Button>
        </form>
      </section>
    </div>
  </div>

  <section class="box stack" id="your-data">
    <h2 class="title">Your data</h2>
    <p class="body">
      Take a copy any time: every account, transaction, category, budget, goal and rule as one file, or just the
      transactions as a spreadsheet. Bank passwords and tokens are never included.
    </p>
    <div class="row wrap">
      <a class="dl" href="/api/export" download>Download everything (JSON)</a>
      <a class="dl" href="/api/export?format=csv" download>Download transactions (CSV)</a>
    </div>

    {#if confirmingDelete}
      <form class="stack danger" method="POST" action="?/deleteAccount" use:enhance>
        <p class="body">
          <b>This deletes your account and everything in it, for good.</b> Connected banks are disconnected, and there is
          no undo. Download a copy first if you want one.
        </p>
        <label class="field">
          <span>Your password</span>
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <label class="field">
          <span>Type DELETE to confirm</span>
          <input name="confirm" autocomplete="off" autocapitalize="characters" required />
        </label>
        <div class="row">
          <Button type="submit">Delete my account</Button>
          <Button variant="small" onclick={() => (confirmingDelete = false)}>Cancel</Button>
        </div>
      </form>
    {:else}
      <div><Button variant="small" onclick={() => (confirmingDelete = true)}>Delete my account…</Button></div>
    {/if}
  </section>
</div>

<style>
  #your-data {
    margin-top: 20px;
  }

  .wrap {
    flex-wrap: wrap;
  }

  .dl {
    display: inline-flex;
    align-items: center;
    padding: 10px 16px;
    border-radius: var(--r-pill);
    border: 1px solid var(--line);
    color: var(--ink);
    font-size: 15px;
    text-decoration: none;
  }

  .dl:hover {
    background: var(--pill);
  }

  .danger {
    padding: 16px;
    border-radius: var(--r-field);
    background: var(--over-soft);
  }

  header,
  .box {
    line-height: normal;
  }

  .note {
    margin: 0;
    padding: 12px 16px;
    border-radius: var(--radius-tile);
    font-size: 13.5px;
    line-height: 1.5;
  }

  .note.warn {
    background: var(--color-accent-100);
    color: var(--color-accent-800);
  }

  .note.good {
    background: var(--color-sage-100);
    color: var(--color-sage-900);
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    align-items: start;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
  }

  .box {
    padding: 26px 28px;
    border-radius: var(--radius-summary-card);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    min-width: 0;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .stack.tight {
    gap: 12px;
  }

  .title {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-heading-weight);
    font-size: 22px;
    line-height: normal;
    letter-spacing: 0;
  }

  .body {
    margin: 0;
    font-size: 14px;
    line-height: 1.55;
    color: var(--color-text-2);
  }

  .fine {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--color-muted);
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  .row {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  /* --- fields --------------------------------------------------------------- */
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field span {
    font-size: 13px;
    font-weight: 600;
  }

  /* The mock's 44px is its content box; with the border it is 46. */
  .field input {
    height: 46px;
    padding: 0 18px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-outline);
    background: var(--color-surface);
  }

  .field small {
    font-size: 12.5px;
    color: var(--color-muted);
  }

  .submit {
    margin-top: 4px;
  }

  /* --- two-factor ----------------------------------------------------------- */
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }

  .head.center {
    align-items: center;
  }

  .enroll {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .qr {
    padding: 10px;
    border-radius: var(--radius-tile);
    background: #fff;
    line-height: 0;
  }

  .qr :global(svg) {
    display: block;
    width: 160px;
    height: 160px;
  }

  .secret {
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--color-inset);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    letter-spacing: 0.08em;
    word-break: break-all;
  }

  /* --- sessions ------------------------------------------------------------- */
  .sessions {
    display: flex;
    flex-direction: column;
    padding: 22px 28px;
  }

  .sessions .head {
    margin-bottom: 8px;
  }

  .meta {
    font-size: 12.5px;
    color: var(--color-muted);
  }

  .session {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 0;
    border-top: 1px solid var(--color-row-divider);
  }

  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--color-inset);
    font-size: 12px;
    font-weight: 700;
    color: var(--color-muted);
  }

  .name {
    font-size: 14.5px;
    font-weight: 600;
  }

  .signout {
    padding-top: 12px;
    border-top: 1px solid var(--color-row-divider);
  }

  @media (max-width: 900px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 639px) {
    .box,
    .sessions {
      padding: var(--pad-phone-card);
    }
  }
</style>
