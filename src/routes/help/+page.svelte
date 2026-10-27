<script lang="ts">
  import { enhance } from '$app/forms';
  import { afterNavigate } from '$app/navigation';
  import { fullDate } from '$lib/format';
  import Button from '$lib/components/Button.svelte';

  let { data, form } = $props();
  let busy = $state(false);
  let kind = $state('wrong');

  const KINDS = [
    { value: 'wrong', label: 'Something looks wrong' },
    { value: 'question', label: 'A question' },
    { value: 'idea', label: 'An idea' }
  ];

  // Where the person was before Help -- that is the page the report is about.
  // A client-side navigation says so directly; a fresh load only has the
  // referrer, which the same-origin policy keeps to this site.
  let from = $state('');
  afterNavigate(({ from: prev }) => {
    if (prev?.url && prev.url.pathname !== '/help') {
      from = prev.url.pathname;
    } else if (!from && document.referrer) {
      try {
        const r = new URL(document.referrer);
        if (r.origin === location.origin && r.pathname !== '/help') from = r.pathname;
      } catch {
        // An unparsable referrer is no referrer.
      }
    }
  });

  const syncLine = $derived.by(() => {
    const s = data.lastSync;
    if (!s) return 'No sync yet';
    const how =
      s.status === 'failed'
        ? 'it didn’t finish'
        : s.stopped
          ? `${s.stopped} account${s.stopped === 1 ? '' : 's'} not syncing`
          : 'all accounts answered';
    return `${fullDate(s.at)} · ${how}`;
  });
</script>

<svelte:head><title>Help · howToMoney</title></svelte:head>

<div class="hf-page">
  <header>
    <h1 class="hf-title">Help</h1>
    <p class="hf-lede">Something not working, or not making sense? Say so here.</p>
  </header>

  <div class="cols">
    <section class="box form-card">
      {#if form?.success}
        <h2 class="title">Sent — thank you</h2>
        <p class="body">
          Your message is on its way. You don’t need to do anything else; if a reply is needed, it
          will come by email.
        </p>
        <div><Button href="/">Back to the dashboard</Button></div>
      {:else}
        <form
          method="POST"
          use:enhance={() => {
            busy = true;
            return async ({ update }) => {
              await update({ reset: false });
              busy = false;
            };
          }}
        >
          <fieldset class="field">
            <legend>What kind of thing is this?</legend>
            <div class="pills">
              {#each KINDS as k (k.value)}
                <label class="pill" class:on={kind === k.value}>
                  <input type="radio" name="kind" value={k.value} bind:group={kind} />
                  {k.label}
                </label>
              {/each}
            </div>
          </fieldset>

          <label class="field">
            <span class="label">What happened?</span>
            <textarea
              name="message"
              required
              placeholder="For example: my credit card balance looks too high, or the Envelopes page is empty."
            ></textarea>
            <small>Plain words are fine — no need for technical detail.</small>
          </label>

          <input type="hidden" name="page" value={from} />

          {#if form?.message}<p class="error">{form.message}</p>{/if}

          <div class="send">
            <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send'}</Button>
            {#if !data.configured}
              <small>Email isn’t set up on this server yet, so it goes to the log.</small>
            {/if}
          </div>
        </form>
      {/if}
    </section>

    <aside class="box side">
      <span class="eyebrow">Sent along with it</span>
      <div class="tile">
        <div class="tile-title">Last sync</div>
        <div class="tile-meta">{syncLine}</div>
      </div>
      <div class="tile">
        <div class="tile-title">Where you were</div>
        <div class="tile-meta">The page you came from, and this browser</div>
      </div>
    </aside>
  </div>

  <!-- Written for someone who has never met the people running this server:
       what it can see, what it keeps, and how to leave. Every answer has to
       stay true of the code -- change one when the behaviour changes. -->
  <section class="faq" aria-labelledby="faq-title">
    <h2 id="faq-title" class="eyebrow">Common questions</h2>
    <div class="box faq-list">
      <details>
        <summary>How does it connect to my bank?</summary>
        <p>
          Through SimpleFIN Bridge or Plaid. You sign in to your bank on their page, never on this one, and they hand
          back a read-only key that is stored encrypted. With it the app can read balances and transactions. It cannot
          move money or change anything at your bank.
        </p>
      </details>
      <details>
        <summary>What does it keep?</summary>
        <p>
          Your accounts and their balance each day, your transactions, and what you add: categories, notes, rules,
          budgets, goals and the questions you ask the Advisor. Never your bank password.
        </p>
      </details>
      <details>
        <summary>Who can see my money?</summary>
        <p>
          Only someone signed in to your account. Each household's rows are walled off by the database itself, not just
          by the app's code, so a mistake in a page cannot show one household another's money. Whoever runs the server
          can reach the database, as with any service that stores data.
        </p>
      </details>
      <details>
        <summary>Does AI see my transactions?</summary>
        <p>
          In two places. To sort a purchase from a merchant the app has not seen before, it sends Anthropic's Claude the
          bank's description of it, the amount and the kind of account -- nothing with your name or an account number.
          Once a merchant is learned it is never sent again. The Advisor works from totals: categories, merchant names
          and account names, never a list of transactions.
        </p>
      </details>
      <details>
        <summary>Is the Advisor financial advice?</summary>
        <p>
          No. It explains your own numbers, which the app works out, not the AI. It is guidance, not financial or
          investment advice.
        </p>
      </details>
      <details>
        <summary>A transaction is missing. Why?</summary>
        <p>
          Banks pass new transactions along about once a day, and some never send pending ones -- a paycheck can show in
          your bank's app hours before it reaches here. The app checks every few hours, and Sync checks now.
        </p>
      </details>
      <details>
        <summary>Can I hide the numbers on screen?</summary>
        <p>The eye button at the top (or the H key) hides every amount until you press it again.</p>
      </details>
      <details>
        <summary>What happens when something breaks?</summary>
        <p>
          An error report goes to the people running the app, with no names, email addresses, amounts or anything from
          your accounts in it.
        </p>
      </details>
      <details>
        <summary>How do I leave?</summary>
        <p>
          Settings › <a href="/security">Security</a> › Your data: download everything first if you want a copy, then
          delete your account. That removes it and everything in it and disconnects your banks. The nightly backups keep
          a copy for up to 30 days, then it is gone. A SimpleFIN Bridge subscription is your own; cancel it there.
        </p>
      </details>
    </div>
  </section>
</div>

<style>
  header,
  .box {
    line-height: normal;
  }


  .cols {
    display: grid;
    grid-template-columns: 620px minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }

  .box {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    min-width: 0;
  }

  .form-card {
    padding: 26px 28px;
    border-radius: var(--radius-summary-card);
  }

  .form-card,
  form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .title {
    margin: 0;
    font-family: var(--font-heading);
    font-weight: var(--font-heading-weight);
    font-size: 22px;
    line-height: normal;
  }

  .body {
    margin: 0;
    font-size: 14px;
    line-height: 1.55;
    color: var(--color-text-2);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend,
  .label {
    padding: 0;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 600;
  }

  /* A legend does not take part in the fieldset's flex gap. */
  .label {
    margin-bottom: 0;
  }

  .pills {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .pill {
    position: relative;
    padding: 8px 16px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border-outline);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--step);
  }

  .pill:hover {
    background: var(--color-accent-100);
  }

  /* The border stays, in the fill's own colour, so selecting a pill does not
     change its size. */
  .pill.on {
    background: var(--color-dark);
    border-color: var(--color-dark);
    color: var(--color-on-accent);
  }

  .pill input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .pill:has(input:focus-visible) {
    outline: var(--focus-outline);
    outline-offset: var(--focus-offset);
  }

  textarea {
    height: 170px;
    padding: 14px 18px;
    border-radius: var(--radius-tile-lg);
    border: 1px solid var(--color-border-outline);
    background: var(--color-surface);
    font-size: 14.5px;
    line-height: 1.5;
    resize: vertical;
  }

  textarea::placeholder {
    color: var(--color-faint);
  }

  small {
    font-size: 12.5px;
    color: var(--color-muted);
  }

  .error {
    margin: 0;
    padding: 12px 16px;
    border-radius: var(--radius-tile);
    background: var(--color-accent-100);
    color: var(--color-accent-800);
    font-size: 13.5px;
    line-height: 1.5;
  }

  .send {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .send :global(.v-primary) {
    padding: 10px 22px;
  }

  /* --- sent along ----------------------------------------------------------- */
  .side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 22px;
    border-radius: var(--radius-list-card);
  }

  .eyebrow {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .tile {
    padding: 12px 14px;
    border-radius: var(--radius-tile);
    background: var(--color-inset);
    font-size: 13.5px;
  }

  .tile-title {
    font-weight: 600;
  }

  .tile-meta {
    font-size: 12.5px;
    color: var(--color-muted);
  }

  @media (max-width: 1000px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 639px) {
    .form-card,
    .side {
      padding: var(--pad-phone-card);
    }
  }

  .faq {
    max-width: 620px;
    margin-top: 32px;
    line-height: normal;
  }

  .faq h2 {
    margin: 0 0 10px 4px;
  }

  .faq-list {
    border-radius: var(--radius-summary-card);
    overflow: hidden;
  }

  details + details {
    border-top: 1px solid var(--color-border);
  }

  summary {
    padding: 16px 20px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    list-style-position: outside;
  }

  summary:focus-visible {
    outline: var(--focus-outline);
    outline-offset: -2px;
  }

  details p {
    margin: 0;
    padding: 0 20px 18px;
    font-size: 15px;
    line-height: 1.55;
    color: var(--color-text-2);
  }

  details a {
    color: var(--accent-text);
  }

  @media (max-width: 1000px) {
    .faq {
      max-width: none;
    }
  }
</style>
