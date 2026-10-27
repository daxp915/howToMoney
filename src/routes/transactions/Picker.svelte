<script lang="ts">
  import Btn from '$lib/components/ui/Btn.svelte';
  import Toggle from '$lib/components/ui/Toggle.svelte';

  /**
   * The category picker: Back, search, a 3-column grid of emoji
   * tiles (the chosen one soft accent with a 1.5px accent ring), and "Always
   * use for <merchant>", which turns the choice into a rule and files the
   * merchant's past rows too. Rules are made here; Settings › Rules only
   * reviews them.
   */
  let {
    categories,
    current,
    merchant,
    pastCount,
    alwaysDefault = false,
    showAlways = true,
    onback,
    ondone
  }: {
    categories: { id: string; name: string; icon: string | null }[];
    current: string | null;
    merchant: string;
    pastCount: number;
    alwaysDefault?: boolean;
    showAlways?: boolean;
    onback: () => void;
    ondone: (categoryId: string, always: boolean) => void;
  } = $props();

  let q = $state('');
  // svelte-ignore state_referenced_locally
  let chosen = $state(current);
  // svelte-ignore state_referenced_locally
  let always = $state(alwaysDefault);

  const shown = $derived(
    q.trim()
      ? categories.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
      : categories.slice(0, 9)
  );
</script>

<div class="picker">
  <div class="bar">
    <button type="button" class="back" onclick={onback}>‹ Back</button>
    <span class="title">Category</span>
    <span class="spacer"></span>
  </div>

  <input class="search" type="search" placeholder="Search categories" bind:value={q} aria-label="Search categories" />

  <div class="section-label">{q.trim() ? 'Matches' : 'Suggested'}</div>
  <div class="grid">
    {#each shown as c (c.id)}
      <button
        type="button"
        class="tile"
        class:on={chosen === c.id}
        aria-pressed={chosen === c.id}
        onclick={() => (chosen = c.id)}
      >
        <span class="emoji" aria-hidden="true">{c.icon ?? '•'}</span>
        <span class="nm">{c.name}</span>
      </button>
    {:else}
      <p class="none">No category called that.</p>
    {/each}
  </div>

  {#if showAlways}<label class="always">
    <span class="txt">
      <span class="a-title">Always use for {merchant}</span>
      <span class="a-sub"
        >Creates a rule.{#if pastCount} Applies to {pastCount} past transaction{pastCount === 1 ? '' : 's'} too.{/if}</span
      >
    </span>
    <Toggle label="Always use for {merchant}" bind:checked={always} />
  </label>{/if}

  <div class="foot">
    <Btn variant="primary" full disabled={!chosen} onclick={() => chosen && ondone(chosen, always)}>Done</Btn>
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 100%;
  }

  .bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
  }

  .back {
    justify-self: start;
    min-height: 0;
    padding: 4px 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
  }

  .back:hover {
    background: none;
    text-decoration: underline;
  }

  .title {
    font-size: 17px;
    font-weight: 500;
  }

  .search {
    min-height: 0;
    padding: 13px 16px;
    border: 1px solid var(--line);
    border-radius: var(--r-field);
    background: var(--field);
    font-size: 16px;
  }

  .section-label {
    margin-bottom: -6px;
    padding: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 82px;
    padding: 10px 6px;
    border: 0;
    border-radius: var(--r-tile);
    background: var(--pill);
    color: var(--ink-2);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .tile:hover {
    background: color-mix(in srgb, var(--pill) 85%, var(--ink) 6%);
  }

  .tile:active {
    transform: none;
  }

  .tile.on,
  .tile.on:hover {
    background: var(--accent-soft);
    color: var(--accent-text);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }

  .emoji {
    font-size: 24px;
  }

  .nm {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .none {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 14px;
    color: var(--ink-3);
  }

  .always {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    border-radius: var(--r-tile);
    background: var(--pill);
    cursor: pointer;
  }

  .txt {
    flex: 1 1 0%;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .a-title {
    font-size: 15px;
    font-weight: 500;
  }

  .a-sub {
    font-size: 13px;
    color: var(--ink-2);
  }

  .foot {
    margin-top: auto;
    padding-top: 8px;
  }
</style>
