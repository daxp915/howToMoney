<script lang="ts">
  import { enhance } from '$app/forms';
  import { fullDate } from '$lib/format';
  import BackLink from '$lib/components/BackLink.svelte';

  let { data, form } = $props();

  let confirming = $state<string | null>(null);
  let resetting = $state<string | null>(null);
  let copied = $state(false);

  // A link is one click for them; the bare code is the fallback for reading it
  // down the phone, which is why both are shown.
  const inviteLink = (code: string) =>
    `${typeof location === 'undefined' ? '' : location.origin}/register?code=${encodeURIComponent(code)}`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard access can be refused; the code is on screen either way.
    }
  }
</script>

<BackLink href="/settings" label="Back to settings" />

<div class="page-head">
  <div>
    <h1>Users</h1>
    <div class="muted">
      {data.users.length}
      {data.users.length === 1 ? 'account' : 'accounts'} on this instance
    </div>
  </div>
</div>

{#if form?.message}<p class="error">{form.message}</p>{/if}
{#if form?.created}<p class="muted">Created {form.created}.</p>{/if}
{#if form?.passwordSet}
  <p class="muted">
    Password updated. They must change it at next sign-in{#if form.signedOut}, and {form.signedOut}
      session{form.signedOut === 1 ? '' : 's'} {form.signedOut === 1 ? 'was' : 'were'} signed out{/if}.
  </p>
{/if}
{#if form?.removed}<p class="muted">Account deleted.</p>{/if}
{#if form?.inviteRevoked}<p class="muted">Invite revoked.</p>{/if}
{#if form?.invitesPurged}<p class="muted">Removed {form.invitesPurged} expired invite codes.</p>{/if}

<!-- The validation plan's numbers: who comes back each week, the day-30
     answer, and what each person costs to run ($lib/server/beta). -->
<div class="card beta" style="margin-bottom:18px">
  <h2 style="margin-top:0">Beta</h2>
  <div class="beta-sum">
    <div>
      <span class="field">Weekly actives, last 8 weeks</span>
      <div class="weeks" aria-label="Active people per week">
        {#each data.beta.weekly as w (w.week)}
          <span class="wk" title="Week of {w.week}: {w.active}"
            ><i style="height: {Math.max(4, (w.active / Math.max(1, data.beta.rows.length)) * 40)}px"></i><b>{w.active}</b></span
          >
        {/each}
      </div>
    </div>
    <div>
      <span class="field">Day-30 answer</span>
      {#if data.beta.pmf.answered}
        <p class="big">
          {Math.round((data.beta.pmf.very / data.beta.pmf.answered) * 100)}% very disappointed
        </p>
        <p class="muted">
          {data.beta.pmf.very} very · {data.beta.pmf.somewhat} somewhat · {data.beta.pmf.not} not, of {data.beta.pmf
            .answered}. Above 40% is the sign people would miss it.
        </p>
      {:else}
        <p class="muted">Nobody has reached day 30 yet. Home asks once, 30 days after an account begins.</p>
      {/if}
    </div>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Person</th><th>Joined</th><th>Days used (7 / 30)</th><th>Last 8 weeks</th><th>Banks</th><th
            >AI, 30 days</th
          ><th>Cost / month</th><th>Day 30</th>
        </tr>
      </thead>
      <tbody>
        {#each data.beta.rows as r (r.id)}
          <tr>
            <td>{r.email}</td>
            <td>{fullDate(r.joined)}</td>
            <td class="num">{r.days7} / {r.days30}</td>
            <td><span class="dots">{#each r.weeks as on, i (i)}<i class:on></i>{/each}</span></td>
            <td>{r.plaidBanks ? `${r.plaidBanks} Plaid` : ''}{r.plaidBanks && r.simplefin ? ' + ' : ''}{r.simplefin
                ? 'SimpleFIN'
                : ''}{!r.plaidBanks && !r.simplefin ? '—' : ''}</td>
            <td class="num">${r.aiUsd.toFixed(2)}</td>
            <td class="num">{r.costUsd === null ? '—' : `$${r.costUsd.toFixed(2)}`}</td>
            <td>{r.pmf ?? '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if data.beta.plaidRate === null}
    <p class="muted">Set PLAID_COST_PER_ITEM (dollars per connected bank per month, from Plaid's quote) to see cost per person.</p>
  {/if}
</div>

<div class="card" style="margin-bottom:18px">
  <h2 style="margin-top:0">Add someone</h2>
  <form method="POST" action="?/create" use:enhance class="new-user">
    <label>
      <span class="field">Email</span>
      <input name="email" type="email" placeholder="dad@example.com" required />
    </label>
    <label>
      <span class="field">Temporary password</span>
      <input name="password" type="text" minlength={data.minPassword} required />
    </label>
    <label style="display:flex; gap:10px; align-items:center; align-self:end; width:auto">
      <input type="checkbox" name="isAdmin" style="width:auto" />
      <span>Make them an admin</span>
    </label>
    <div style="align-self:end">
      <button class="primary" type="submit">Create account</button>
    </div>
  </form>
  <p class="muted" style="margin:10px 0 0">
    They get their own categories, their own budgets and their own bank connection. Nothing is
    shared — you will not see their transactions and they will not see yours. Send them the
    password out of band — the app makes them replace it before it lets them do anything else.
  </p>
</div>

<div class="card" style="margin-bottom:18px">
  <h2 style="margin-top:0">Invite someone</h2>
  <p class="muted" style="margin:0 0 12px">
    An invite code is the only way somebody can register. They choose their own password, so you
    never know it, and the code works once.
  </p>

  <form method="POST" action="?/invite" use:enhance class="new-user">
    <label>
      <span class="field">Their email (optional)</span>
      <input name="email" type="email" placeholder="dad@example.com" />
      <span class="hint">If set, only that address can use the code.</span>
    </label>
    <label>
      <span class="field">Note (optional)</span>
      <input name="note" type="text" placeholder="Dad" />
    </label>
    <label>
      <span class="field">Expires in (days)</span>
      <input name="ttlDays" type="number" min="1" max="90" value="14" />
    </label>
    <div style="align-self:end">
      <button class="primary" type="submit">Create invite</button>
    </div>
  </form>

  {#if form?.invite}
    <div class="issued">
      <div class="field">Send them this link — the code is shown only now</div>
      <code class="code">{inviteLink(form.invite.code)}</code>
      <div class="muted" style="font-size:13px">
        Or the code on its own: <strong>{form.invite.code}</strong> · expires
        {fullDate(form.invite.expiresAt)}
      </div>
      <button class="ghost" type="button" onclick={() => copy(inviteLink(form.invite.code))}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  {/if}

  {#if data.invites.length}
    <div class="table-wrap">
        <table style="margin-top:14px">
        <thead>
          <tr>
            <th>Code for</th>
            <th>Note</th>
            <th>Status</th>
            <th>Expires</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each data.invites as i (i.id)}
            <tr>
              <td>{i.usedByEmail ?? i.email ?? 'anyone with the code'}</td>
              <td class="muted">{i.note ?? '—'}</td>
              <td>
                <span class="status {i.status}">{i.status}</span>
              </td>
              <td class="muted">{fullDate(i.expiresAt)}</td>
              <td class="num">
                {#if i.status !== 'used'}
                  <form method="POST" action="?/revokeInvite" use:enhance>
                    <input type="hidden" name="id" value={i.id} />
                    <button class="ghost" type="submit">Revoke</button>
                  </form>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <form method="POST" action="?/purgeInvites" use:enhance style="margin-top:10px">
      <button class="ghost" type="submit">Clear out expired codes</button>
    </form>
  {/if}
</div>

<p class="muted" style="margin:0 0 12px">
  A reset signs that person out everywhere and makes them choose a new password
  before they can use the app — including you, if you reset your own.
</p>

<div class="table-wrap">
    <table>
    <thead>
      <tr>
        <th>Account</th>
        <th class="hide-sm">Added</th>
        <th class="num">Data</th>
        <th class="num" style="width:230px"></th>
      </tr>
    </thead>
    <tbody>
      {#each data.users as u (u.id)}
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
              <span>{u.email}</span>
              {#if u.isAdmin}<span class="chip">admin</span>{/if}
              {#if u.id === data.me}<span class="chip">you</span>{/if}
              {#if u.totpEnabled}<span class="chip">2FA</span>{/if}
              {#if u.mustChangePassword}
                <span class="chip" style="color:var(--bad)">temporary password</span>
              {/if}
            </div>
            <div class="sub">
              {u.hasCredentials ? 'bank connected' : 'no bank connection yet'}
            </div>
          </td>
          <td class="hide-sm muted">{fullDate(u.createdAt)}</td>
          <td class="num muted">
            {u.accountCount} accounts · {u.transactionCount} txns
          </td>
          <td class="num">
            {#if confirming === u.id}
              <form
                method="POST"
                action="?/remove"
                use:enhance={() =>
                  async ({ update }) => {
                    await update();
                    confirming = null;
                  }}
                class="toolbar"
                style="justify-content:flex-end"
              >
                <input type="hidden" name="id" value={u.id} />
                <span class="muted">Delete everything?</span>
                <button class="danger" type="submit">Yes, delete</button>
                <button type="button" onclick={() => (confirming = null)}>Cancel</button>
              </form>
            {:else if resetting === u.id}
              <form
                method="POST"
                action="?/password"
                use:enhance={() =>
                  async ({ update }) => {
                    await update();
                    resetting = null;
                  }}
                class="toolbar"
                style="justify-content:flex-end"
              >
                <input type="hidden" name="id" value={u.id} />
                <input
                  name="password"
                  type="text"
                  minlength={data.minPassword}
                  placeholder="new password"
                  style="width:200px"
                />
                <button class="primary" type="submit">Set</button>
                <button type="button" onclick={() => (resetting = null)}>Cancel</button>
              </form>
            {:else}
              <div class="toolbar" style="justify-content:flex-end">
                <button type="button" onclick={() => (resetting = u.id)}>
                  {u.id === data.me ? 'Reset my password' : 'Reset password'}
                </button>
                {#if u.id !== data.me}
                  <form method="POST" action="?/admin" use:enhance>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="isAdmin" value={u.isAdmin ? 'false' : 'true'} />
                    <button type="submit">{u.isAdmin ? 'Revoke admin' : 'Make admin'}</button>
                  </form>
                  <button class="danger" type="button" onclick={() => (confirming = u.id)}>
                    Delete
                  </button>
                {/if}
              </div>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<p class="muted" style="margin-top:14px">
  Deleting an account removes its transactions, accounts, budgets, goals, rules, learned merchants
  and stored bank credentials. There is no undo, and no soft delete — the point of removing someone
  is that their financial history goes with them.
</p>

<style>
  .beta-sum {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 20px;
    margin-bottom: 16px;
  }

  .weeks {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 64px;
    margin-top: 8px;
  }

  .wk {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }

  .wk i {
    display: block;
    width: 18px;
    border-radius: 4px;
    background: var(--accent);
  }

  .wk b {
    font-weight: 500;
  }

  .big {
    margin: 6px 0 2px;
    font-size: 22px;
    font-weight: 500;
  }

  .table-wrap {
    overflow-x: auto;
  }

  .beta table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }

  .beta th,
  .beta td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    text-align: left;
    white-space: nowrap;
  }

  .beta th {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-3);
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .dots {
    display: inline-flex;
    gap: 3px;
  }

  .dots i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--pill);
  }

  .dots i.on {
    background: var(--ok);
  }

  .issued {
    margin-top: 14px;
    padding: 14px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    display: grid;
    gap: 8px;
    justify-items: start;
  }

  .code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 14px;
    word-break: break-all;
  }

  .hint {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .status {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
  }

  .status.open {
    border-color: var(--good);
    color: var(--good);
  }

  .status.expired {
    border-color: var(--border-strong);
    color: var(--text-muted);
  }

  .new-user {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
    align-items: start;
  }
</style>
