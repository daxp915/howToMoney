<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { issuesSignature, SNOOZE_COOKIE, type ConnectionIssue } from '$lib/connectionHealth';
  import { SIMPLEFIN_URL } from '$lib/simplefin';

  /**
   * A broken connection, said on every page until it is fixed (or hidden for
   * the day). A balance that silently stops moving is worse than no balance:
   * every figure built on it looks right and is not. The avatar keeps its
   * yellow dot while the banner is hidden; Settings > Connections has the
   * whole list.
   */
  let { issues, snoozed = false }: { issues: ConnectionIssue[]; snoozed?: boolean } = $props();

  // svelte-ignore state_referenced_locally
  let hidden = $state(snoozed);

  const since = (d: Date | string | null) =>
    d ? ` since ${new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';

  function snooze() {
    try {
      document.cookie = `${SNOOZE_COOKIE}=${issuesSignature(issues)}; path=/; max-age=86400; samesite=lax`;
    } catch {
      // A blocked cookie only means it shows again on the next page.
    }
    hidden = true;
  }

  const one = $derived(issues.length === 1 ? issues[0] : null);
</script>

{#if issues.length && !hidden}
  <div class="ca" role="alert">
    <span class="ic" aria-hidden="true"><Icon name="alert" size={18} stroke={2} /></span>
    <div class="body">
      {#if one}
        <p class="t">{one.title}<span class="since">{since(one.since)}</span></p>
        <p class="d">{one.detail}</p>
      {:else}
        <p class="t">{issues.length} connections need you</p>
        <p class="d">{issues.map((x) => x.title).join(' · ')}</p>
      {/if}
      <div class="acts">
        {#if one?.fix === 'simplefin'}
          <a class="act" href={SIMPLEFIN_URL} target="_blank" rel="noreferrer noopener">Fix at SimpleFIN ↗</a>
          <a class="act quiet" href="/settings/connections">Connections ›</a>
        {:else if one?.fix === 'token' || one?.fix === 'plaid'}
          <a class="act" href="/settings/connections">Reconnect ›</a>
        {:else}
          <a class="act" href="/settings/connections">{one ? 'Details' : 'See all'} ›</a>
        {/if}
        <button type="button" class="act quiet" onclick={snooze}>Hide for today</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ca {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: var(--space-4);
    padding: 14px 16px;
    border-radius: var(--r-card, 14px);
    background: var(--watch-soft);
    color: var(--watch-text);
    line-height: 1.4;
  }

  .ic {
    flex: none;
    margin-top: 1px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .t {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .since {
    font-weight: 400;
  }

  .d {
    margin: 0;
    font-size: 14px;
    color: var(--ink-2);
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-top: 6px;
  }

  /* Every property the global button rule sets, reset. */
  .act {
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--watch-text);
    text-decoration: none;
    cursor: pointer;
  }

  .act.quiet {
    font-weight: 500;
    color: var(--ink-2);
  }

  .act:hover {
    text-decoration: underline;
  }
</style>
