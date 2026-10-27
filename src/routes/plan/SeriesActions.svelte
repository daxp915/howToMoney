<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import Money from '$lib/components/ui/Money.svelte';
  import { toast } from '$lib/toast.svelte';
  import type { PlanEvent } from '$lib/server/plan';

  /**
   * A recurring row's actions: the series, "$11.99 every month ·
   * next on Oct 14", then what can be done with it. "Ignore this series" is
   * the existing setStatus action; a resync never undoes it. It is fully
   * reversible, so it asks nothing first and offers Undo in a toast instead.
   */
  let { event, onclose }: { event: PlanEvent & { series: NonNullable<PlanEvent['series']> }; onclose: () => void } = $props();

  const s = $derived(event.series);
  const every = $derived.by(() => {
    const d = s.cadenceDays;
    if (d >= 26 && d <= 35) return 'every month';
    if (d >= 6 && d <= 8) return 'every week';
    if (d >= 13 && d <= 15) return 'every 2 weeks';
    if (d >= 85 && d <= 95) return 'every 3 months';
    if (d >= 355 && d <= 375) return 'every year';
    return `every ${d} days`;
  });
  const next = $derived(new Date(s.next + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

  async function setStatus(status: 'active' | 'ignored') {
    const body = new FormData();
    body.set('id', s.id);
    body.set('status', status);
    await fetch('?/setStatus', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
    await invalidateAll();
  }
</script>

<div class="sa">
  <div class="head">
    <span class="nm">{event.name}</span>
    <span class="meta"
      >{#if s.manual}<Money value={s.usual} />{:else}<Money value={s.usual} href={event.href} />{/if} {every} · next on {next}</span
    >
  </div>
  <div class="group">
    {#if !s.manual}
      <a class="item" href={event.href} onclick={onclose}>
        <span class="t">See past charges</span>
        <span class="chev" aria-hidden="true">›</span>
      </a>
    {/if}
    <form
      method="POST"
      action="?/setStatus"
      use:enhance={() => {
        const name = event.name;
        onclose();
        return async ({ update }) => {
          await update();
          toast.show(s.manual ? `${name} removed` : `${name} no longer counts as recurring`, () => setStatus('active'));
        };
      }}
    >
      <input type="hidden" name="id" value={s.id} />
      <input type="hidden" name="status" value="ignored" />
      <button type="submit" class="item">
        {#if s.manual}
          <span class="t">Remove this bill<span class="sub">It comes off the calendar and out of every forecast.</span></span>
        {:else}
          <span class="t"
            >Ignore this series<span class="sub">{event.name} stops counting as recurring. Past charges stay in Activity.</span></span
          >
        {/if}
      </button>
    </form>
  </div>
  <button type="button" class="cancel" onclick={onclose}>Cancel</button>
</div>

<style>
  .sa {
    display: flex;
    flex-direction: column;
    gap: 14px;
    line-height: normal;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 4px;
  }

  .nm {
    font-size: 20px;
    font-weight: 500;
  }

  .meta {
    font-size: 14px;
    color: var(--ink-2);
  }

  .meta :global(.figure) {
    color: inherit;
  }

  .group {
    border-radius: 16px;
    overflow: hidden;
    background: var(--pill);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 0;
    margin: 0;
    padding: 13px 16px;
    border: 0;
    border-top: 1px solid var(--surface);
    border-radius: 0;
    background: none;
    font: inherit;
    font-size: 16px;
    color: var(--ink);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .group > :first-child.item,
  .group > :first-child .item {
    border-top: 0;
  }

  .item:hover {
    background: var(--track);
  }

  .t {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sub {
    font-size: 13px;
    line-height: 1.4;
    color: var(--ink-2);
  }

  .chev {
    color: var(--ink-3);
  }

  .cancel {
    min-height: 0;
    margin: 0;
    padding: 13px;
    border: 0;
    border-radius: var(--r-pill);
    background: none;
    font: inherit;
    font-size: 16px;
    font-weight: 500;
    color: var(--ink);
    cursor: pointer;
  }

  .cancel:hover {
    background: var(--pill);
  }
</style>
