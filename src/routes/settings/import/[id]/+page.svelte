<script lang="ts">
  import { enhance } from '$app/forms';
  import MaskedText from '$lib/components/MaskedText.svelte';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Field from '$lib/components/ui/Field.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import { money, shortDate } from '$lib/format';

  /**
   * Import a file, second half: the chosen file, the account it
   * goes into, what is in it -- new rows, rows already in HTMFD, the dates --
   * and one button that says how many will land. The counts are the import's
   * own matching run dry, so the button's number is the number imported.
   *
   * A CSV's columns are guessed; "Check the columns" opens the mapping and a
   * preview, and opens by itself when rows could not be read.
   */
  let { data, form } = $props();

  const s = $derived(data.summary);
  const done = $derived(data.batch.status === 'committed' || form?.imported !== undefined);
  const kind = $derived(data.format === 'ofx' ? 'OFX' : 'CSV');
  let busy = $state(false);
  let mapForm: HTMLFormElement | undefined = $state();
  let acctForm: HTMLFormElement | undefined = $state();

  const size = (n: number) => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const day = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
  const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
</script>

<svelte:head><title>{data.batch.filename} · Import · HTMFD</title></svelte:head>

<div class="imp">
  <header class="intro">
    <h1>Import a file</h1>
    <p class="lede">A CSV or OFX export from your bank's website.</p>
  </header>

  <Card>
    <div class="filerow">
      <span class="tile">{kind}</span>
      <span class="who"><span class="nm">{data.batch.filename}</span><span class="meta">{size(s.bytes)}</span></span>
      {#if !done}<a class="go" href="/settings/import">Change</a>{/if}
    </div>
  </Card>

  {#if done}
    {@const added = form?.imported ?? data.batch.imported ?? 0}
    {@const dupes = form?.duplicates ?? data.batch.duplicates ?? 0}
    <Section label="Imported">
      <Card>
        <div class="kv"><span>Added to {data.batch.accountName}</span><b>{added.toLocaleString()}</b></div>
        <div class="kv quiet"><span>Already in HTMFD, skipped</span><span>{dupes.toLocaleString()}</span></div>
        {#if form?.transfersMatched}<div class="kv quiet"><span>Matched as transfers</span><span>{form.transfersMatched}</span></div>{/if}
        {#if form?.errors?.length}<div class="kv quiet"><span>Rows that couldn't be read</span><span>{form.skipped}</span></div>{/if}
      </Card>
    </Section>
    <div class="foot">
      <Btn variant="primary" full href="/transactions?review=1">Review them in Activity</Btn>
      <Btn variant="ghost" full href="/settings/import">Import another file</Btn>
    </div>
  {:else}
    <form method="POST" action="?/account" bind:this={acctForm} use:enhance={() => async ({ update }) => update({ reset: false })}>
      <Field label="Into account">
        {#snippet control(id)}
          <select {id} name="accountId" value={data.batch.accountId} onchange={() => acctForm?.requestSubmit()}>
            {#each data.accountOptions as a (a.id)}<option value={a.id}>{a.label}</option>{/each}
          </select>
        {/snippet}
      </Field>
      <noscript><Btn variant="secondary" size="sm" type="submit">Use this account</Btn></noscript>
    </form>

    {#if data.format === 'ofx' && data.ofxAccount?.accountId}
      <p class="note">The file says it is account <b>··{String(data.ofxAccount.accountId).slice(-4)}</b>{data.ofxAccount.isCreditCard ? ', a credit card' : ''}. Make sure that's the one above.</p>
    {/if}

    <Section label="In this file">
      <Card>
        <div class="kv"><span>New transactions</span><b>{s.fresh.toLocaleString()}</b></div>
        <div class="kv quiet"><span>Already in HTMFD, skipped</span><span>{s.duplicates.toLocaleString()}</span></div>
        {#if s.unreadable}<div class="kv bad"><span>Rows that couldn't be read</span><span>{s.unreadable.toLocaleString()}</span></div>{/if}
        {#if s.from}<div class="kv quiet"><span>Dates</span><span>{day(s.from)} – {day(s.to)}</span></div>{/if}
      </Card>
    </Section>

    {#if data.format === 'csv' && data.mapping}
      <details class="cols" open={s.unreadable > 0}>
        <summary>Check the columns</summary>
        <form method="POST" action="?/preview" bind:this={mapForm} use:enhance={() => async ({ update }) => update({ reset: false })} onchange={() => mapForm?.requestSubmit()}>
          <div class="grid">
            {#each [['dateColumn', 'Date'], ['descriptionColumn', 'Description']] as [name, label] (name)}
              <Field {label}>
                {#snippet control(id)}
                  <select {id} {name}>
                    {#each data.headers as h, i (i)}<option value={i} selected={i === data.mapping?.[name as 'dateColumn']}>{h}</option>{/each}
                  </select>
                {/snippet}
              </Field>
            {/each}
            <Field label="Amount">
              {#snippet control(id)}
                <select {id} name="amountColumn">
                  <option value={-1} selected={data.mapping?.amountColumn === -1}>Separate money out / in</option>
                  {#each data.headers as h, i (i)}<option value={i} selected={i === data.mapping?.amountColumn}>{h}</option>{/each}
                </select>
              {/snippet}
            </Field>
            {#if data.mapping.amountColumn === -1}
              {#each [['debitColumn', 'Money out'], ['creditColumn', 'Money in']] as [name, label] (name)}
                <Field {label}>
                  {#snippet control(id)}
                    <select {id} {name}>
                      <option value={-1}>—</option>
                      {#each data.headers as h, i (i)}<option value={i} selected={i === data.mapping?.[name as 'debitColumn']}>{h}</option>{/each}
                    </select>
                  {/snippet}
                </Field>
              {/each}
            {/if}
            <Field label="Date order">
              {#snippet control(id)}
                <select {id} name="dateOrder">
                  <option value="mdy" selected={data.mapping?.dateOrder === 'mdy'}>MM/DD/YYYY</option>
                  <option value="dmy" selected={data.mapping?.dateOrder === 'dmy'}>DD/MM/YYYY</option>
                  <option value="ymd" selected={data.mapping?.dateOrder === 'ymd'}>YYYY-MM-DD</option>
                </select>
              {/snippet}
            </Field>
          </div>
          <label class="check"><input type="checkbox" name="hasHeader" checked={data.mapping.hasHeader} /> First row is a header</label>
          <label class="check"
            ><input type="checkbox" name="invertAmount" checked={data.mapping.invertAmount} /> Flip the sign
            <span class="meta">— if purchases show as positive below, as most card exports do</span></label
          >
          <noscript><Btn variant="secondary" size="sm" type="submit">Re-read the file</Btn></noscript>
        </form>
        <Card>
          {#each data.preview as p, i (i)}
            <div class="prow">
              {#if p.error}
                <span class="bad-t">{p.error}</span>
              {:else}
                <span class="d">{shortDate(p.postedAt)}</span>
                <span class="desc"><MaskedText text={p.description} /></span>
                <span class="a" class:pos={Number(p.amount) > 0}><span class="amt">{money(p.amount)}</span></span>
              {/if}
            </div>
          {/each}
        </Card>
      </details>
    {/if}

    {#if form?.message}<p class="err" role="alert">{form.message}</p>{/if}

    <form class="foot" method="POST" action="?/commit" use:enhance={() => { busy = true; return async ({ update }) => { await update({ reset: false }); busy = false; }; }}>
      <Btn variant="primary" full type="submit" disabled={busy || s.fresh === 0}>
        {busy ? 'Importing…' : s.fresh === 0 ? 'Nothing new to import' : `Import ${plural(s.fresh, 'transaction')}`}
      </Btn>
      <span class="fine">They arrive in Activity, waiting for review.</span>
    </form>
  {/if}
</div>

<style>
  .imp {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 560px;
    line-height: normal;
  }

  .intro h1 {
    margin: 0;
  }

  .lede {
    margin: 6px 0 0;
    font-size: 15px;
    line-height: 1.5;
    color: var(--ink-2);
  }

  .filerow {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
  }

  .tile {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--pill);
    color: var(--ink-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
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
    overflow-wrap: anywhere;
  }

  .meta {
    font-size: 13px;
    color: var(--ink-3);
  }

  .go {
    font-size: 15px;
    font-weight: 500;
    color: var(--accent-text);
    text-decoration: none;
  }

  .kv {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    border-top: 1px solid var(--line);
    font-size: 16px;
    font-variant-numeric: tabular-nums;
  }

  .kv:first-child {
    border-top: 0;
  }

  .kv > :first-child {
    flex: 1 1 auto;
  }

  .kv b {
    font-weight: 500;
  }

  .kv.quiet {
    color: var(--ink-2);
  }

  .kv.bad {
    color: var(--over-text);
  }

  .note {
    margin: -8px 0 0;
    padding: 0 2px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--ink-3);
  }

  .note b {
    font-weight: 500;
    color: var(--ink-2);
  }

  .cols {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .cols summary {
    padding: 0 2px;
    font-size: 15px;
    font-weight: 500;
    color: var(--accent-text);
    cursor: pointer;
  }

  .cols[open] summary {
    margin-bottom: 12px;
  }

  .cols form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 12px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
    gap: 12px;
  }

  .check {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 15px;
  }

  .check input {
    width: auto;
    min-height: 0;
    margin: 0;
  }

  .prow {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px solid var(--line);
    font-size: 14px;
  }

  .prow:first-child {
    border-top: 0;
  }

  .d {
    color: var(--ink-3);
    white-space: nowrap;
  }

  .desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .a {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .a.pos {
    color: var(--money-in);
  }

  .bad-t {
    grid-column: 1 / -1;
    color: var(--over-text);
  }

  .err {
    margin: 0;
    padding: 0 2px;
    font-size: 14px;
    color: var(--over-text);
  }

  .foot {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }

  .fine {
    text-align: center;
    font-size: 13px;
    color: var(--ink-3);
  }
</style>
