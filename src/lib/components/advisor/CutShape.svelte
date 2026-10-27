<script lang="ts">
  import Figure from './Figure.svelte';
  import MaskedText from '$lib/components/MaskedText.svelte';
  import type { CutPayload } from '$lib/advisor/answer';

  /**
   * 7g: each category's usual month as a bar -- the solid part the level to
   * bring it to, the hatched part what that frees -- and the total of the
   * top rows in sage.
   */
  let { payload }: { payload: CutPayload } = $props();

  const money = (v: number, href: string | null = null) => ({ kind: 'money' as const, value: v, href });
  const largest = $derived(Math.max(...payload.rows.map((r) => r.usual), 1));
  const top = $derived(payload.rows.slice(0, payload.topN));
  const total = $derived(top.reduce((s, r) => s + r.frees, 0));
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
</script>

<div class="cut">
  <div class="row head">
    <span>Category</span>
    <span class="desk">Usual month</span>
    <span>Bring it to</span>
    <span class="r">Frees</span>
  </div>
  {#each payload.rows as r (r.name)}
    <div class="row">
      <span><span class="chip">{#if r.icon}{r.icon}{' '}{/if}<MaskedText text={r.name} /></span></span>
      <div class="desk">
        <div class="bar" style="width: {(r.usual / largest) * 100}%">
          <span class="keep" style="flex: {r.aim} 1 0%"></span>
          <span class="free" style="flex: {r.frees} 1 0%"></span>
        </div>
        <span class="usual"><Figure fig={money(r.usual, r.usualHref)} /></span>
      </div>
      <div>
        <span class="aim"><Figure fig={money(r.aim, r.aimHref)} /></span>
        <div class="why"><MaskedText text={r.why} /></div>
      </div>
      <span class="frees r"><Figure fig={money(r.frees)} /></span>
    </div>
  {/each}
  {#if top.length > 1}
    <div class="total">
      <span>The top {words[top.length] ?? top.length} together</span>
      <span class="t-fig"><Figure fig={money(total)} /> a month</span>
    </div>
  {/if}
  {#if payload.months.length}
    <div class="note">Usual = the average of {payload.months.join(', ').replace(/, ([^,]*)$/, ' and $1')}.</div>
  {/if}
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 170px minmax(0, 1fr) 150px 92px;
    gap: 14px;
    align-items: center;
    padding: 11px 0;
    border-top: 1px solid var(--color-rule);
  }
  .row.head {
    padding: 0 0 8px;
    border-top: 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }
  .r {
    text-align: right;
  }
  .chip {
    display: inline-flex;
    padding: 4px 11px;
    border-radius: 999px;
    background: var(--color-accent-100);
    color: var(--color-accent-800);
    font-size: 13px;
    font-weight: 600;
  }
  .bar {
    height: 10px;
    border-radius: 999px;
    display: flex;
    overflow: hidden;
  }
  .keep {
    background: var(--color-accent);
  }
  .free {
    background: repeating-linear-gradient(
      135deg,
      var(--color-out-more) 0,
      var(--color-out-more) 6px,
      var(--color-loose-stripe) 6px,
      var(--color-loose-stripe) 12px
    );
  }
  .usual :global(.fig) {
    display: inline-block;
    margin-top: 5px;
    font-size: 12.5px;
    font-weight: 400;
    color: var(--color-muted);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .aim :global(.fig) {
    font-size: 14px;
  }
  .why {
    font-size: 12px;
    color: var(--color-muted);
  }
  .frees :global(.fig) {
    font-size: 14.5px;
    color: var(--color-sage-700);
  }
  .total {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    padding: 12px 16px;
    margin-top: 6px;
    border-radius: 18px;
    background: var(--color-sage-100);
    color: var(--color-sage-700);
    font-size: 14px;
    font-weight: 600;
  }
  .t-fig {
    font-size: 15px;
    font-weight: 700;
  }
  .note {
    margin-top: 14px;
    font-size: 12.5px;
    color: var(--color-muted);
  }
  /* By the width it is given, not the viewport's: the desktop Advisor panel
     is a phone's width, and four columns there piled on top of each other. */
  .cut {
    container-type: inline-size;
  }
  @container (max-width: 560px) {
    .desk {
      display: none;
    }
    .row {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }
  }
</style>
