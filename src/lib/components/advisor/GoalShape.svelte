<script lang="ts">
  import Figure from './Figure.svelte';
  import MaskedText from '$lib/components/MaskedText.svelte';
  import type { GoalPayload } from '$lib/advisor/answer';

  /** 7f: the goal as the 2b card -- value of target, the bar with its pace
   *  marker -- and when it finishes at the pace and as needed. */
  let { payload }: { payload: GoalPayload } = $props();

  const my = (d: string | null) =>
    d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—';
  const money = (v: number) => ({ kind: 'money' as const, value: v, href: '/plan?tab=goals' });
  const behind = $derived(payload.onTrack === false);
  const monthsLeft = $derived(payload.daysLeft !== null ? Math.max(0, Math.round(payload.daysLeft / 30.44)) : null);
  const late = $derived(
    !!payload.doneAtPace && !!payload.targetDate && payload.doneAtPace.slice(0, 7) > payload.targetDate.slice(0, 7)
  );
</script>

<div class="goal">
  <div class="g-card">
    <div class="g-head">
      <div>
        <div class="g-name"><MaskedText text={payload.name} /></div>
        <div class="g-sub">
          {[payload.account, payload.targetDate ? `by ${my(payload.targetDate)}` : null].filter(Boolean).join(' · ')}
        </div>
      </div>
      {#if payload.onTrack !== null}
        <span class="g-tag" class:behind>{behind ? 'Behind' : 'On track'}</span>
      {/if}
    </div>
    <div class="g-figs">
      <span class="g-now"><Figure fig={money(payload.current)} /></span>of<span class="g-target"><Figure fig={money(payload.target)} /></span>
    </div>
    <div class="bar">
      <span class="fill" class:behind style="width: {payload.progress * 100}%"></span>
      {#if payload.expected !== null}<span class="pace" style="left: {payload.expected * 100}%"></span>{/if}
    </div>
    <div class="g-cap">
      <span>{Math.round(payload.progress * 100)}% there{#if payload.expected !== null}{' '}· | = where you'd need to be today{/if}</span>
      {#if monthsLeft !== null}<span>{monthsLeft} month{monthsLeft === 1 ? '' : 's'} left</span>{/if}
    </div>
    <div class="g-tiles">
      {#if payload.pace !== null}
        <div class="tile">
          <div class="t-label">At your pace, <Figure fig={money(payload.pace)} />/mo</div>
          <div class="t-value" class:late>{payload.doneAtPace ? `Done ${my(payload.doneAtPace)}` : 'Not at this pace'}</div>
        </div>
      {/if}
      {#if payload.needed !== null}
        <div class="tile">
          <div class="t-label">Needed, <Figure fig={money(payload.needed)} />/mo</div>
          <div class="t-value">Done {my(payload.targetDate)}, on time</div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .g-card {
    padding: 20px 22px;
    border-radius: 22px;
    border: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .g-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .g-name {
    font: 400 20px var(--font-heading);
  }
  .g-sub {
    font-size: 12.5px;
    color: var(--color-muted);
    margin-top: 2px;
  }
  .g-tag {
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--color-sage-100);
    color: var(--color-sage-700);
    font-size: 12px;
    font-weight: 700;
  }
  .g-tag.behind {
    background: var(--color-accent-100);
    color: var(--color-accent-800);
  }
  .g-figs {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 14px;
    color: var(--color-muted);
  }
  .g-now :global(.fig) {
    font: 400 24px var(--font-heading);
    color: var(--color-text);
    text-underline-offset: 5px;
  }
  .g-target :global(.fig) {
    color: var(--color-text);
  }
  .bar {
    position: relative;
    height: 14px;
    border-radius: 999px;
    background: var(--color-track);
  }
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    max-width: 100%;
    border-radius: 999px;
    background: var(--color-sage);
  }
  .fill.behind {
    background: var(--color-accent);
  }
  .pace {
    position: absolute;
    top: -5px;
    bottom: -5px;
    width: 2px;
    background: var(--color-dark);
    border-radius: 2px;
  }
  .g-cap {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    color: var(--color-muted);
    gap: 12px;
  }
  .g-tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .tile {
    padding: 12px 16px;
    border-radius: 18px;
    background: var(--color-inset);
  }
  .t-label {
    font-size: 12.5px;
    color: var(--color-muted);
  }
  .t-value {
    font-size: 15px;
    font-weight: 700;
    margin-top: 3px;
  }
  .t-value.late {
    color: var(--color-accent-700);
  }
  @media (max-width: 760px) {
    .g-card {
      padding: 16px;
    }
    .g-tiles {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
