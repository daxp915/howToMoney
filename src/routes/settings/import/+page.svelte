<script lang="ts">
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Field from '$lib/components/ui/Field.svelte';
  import Section from '$lib/components/ui/Section.svelte';

  /**
   * Import a file, first half: the file and the account it goes
   * into. The second half (`[id]`) is the mock's summary -- what is new, what
   * is already here -- and the Import button. Nothing touches the ledger
   * until that button.
   */
  let { data, form } = $props();

  let file = $state<File | null>(null);
  let account = $state('');
  let picker: HTMLInputElement | undefined = $state();
  let busy = $state(false);

  const kind = $derived(file ? (/\.(ofx|qfx)$/i.test(file.name) ? 'OFX' : 'CSV') : '');
  const size = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const when = (d: Date | string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
</script>

<svelte:head><title>Import a file · HTMFD</title></svelte:head>

<form class="imp" method="POST" action="?/upload" enctype="multipart/form-data" onsubmit={() => (busy = true)}>
  <header class="intro">
    <h1>Import a file</h1>
    <p class="lede">A CSV or OFX export from your bank's website.</p>
  </header>

  <!-- The real input is hidden; the row is the control, and "Change" reopens it. -->
  <input
    bind:this={picker}
    class="hidden-file"
    type="file"
    name="file"
    accept=".csv,.ofx,.qfx,text/csv,text/plain,application/x-ofx"
    required
    onchange={(e) => (file = e.currentTarget.files?.[0] ?? null)}
  />
  <Card>
    <button type="button" class="filerow" onclick={() => picker?.click()}>
      <span class="tile">{kind || '+'}</span>
      <span class="who">
        <span class="nm">{file ? file.name : 'Choose a file'}</span>
        <span class="meta">{file ? size(file.size) : 'CSV, OFX or QFX'}</span>
      </span>
      <span class="go">{file ? 'Change' : 'Choose'}</span>
    </button>
  </Card>

  <Field label="Into account">
    {#snippet control(id)}
      <select {id} name="accountId" required bind:value={account}>
        <option value="" disabled>Choose an account</option>
        {#each data.accountOptions as a (a.id)}<option value={a.id}>{a.label}</option>{/each}
      </select>
    {/snippet}
  </Field>

  {#if form?.message}<p class="err" role="alert">{form.message}</p>{/if}

  <div class="foot">
    <Btn variant="primary" full type="submit" disabled={busy || !file || !account}>
      {busy ? 'Reading the file…' : !file ? 'Choose a file' : !account ? 'Choose an account' : 'Continue'}
    </Btn>
    <span class="fine">Nothing is imported until you've seen what's in the file.</span>
  </div>
</form>

{#if data.recent.length}
  <Section label="Recent imports" class="recent">
    <Card>
      {#each data.recent as r (r.id)}
        <a class="row" href="/settings/import/{r.id}">
          <span class="who">
            <span class="nm">{r.filename}</span>
            <span class="meta"
              >{when(r.createdAt)} · {r.accountName} · {r.status === 'committed'
                ? `${r.imported} added${r.duplicates ? `, ${r.duplicates} already here` : ''}`
                : 'not imported'}</span
            >
          </span>
          <span class="chev" aria-hidden="true">›</span>
        </a>
      {/each}
    </Card>
  </Section>
{/if}

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

  .hidden-file {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .filerow,
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 0;
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
    cursor: pointer;
  }

  .filerow,
  .row:first-child {
    border-top: 0;
  }

  .filerow:hover,
  .row:hover {
    background: var(--pill);
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
  }

  .chev {
    color: var(--ink-3);
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

  :global(.recent) {
    max-width: 560px;
    margin-top: 32px;
  }
</style>
