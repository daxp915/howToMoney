<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  /**
   * The v2 field: a 14/500 label above a boxed 16px input (surface, 1px
   * line, radius 12, 13px 14px), focus = accent border + 3px accent-soft
   * ring. An error turns it --over with an --over-soft ring and puts the reason
   * underneath -- form errors are the only use of --over outside budgets. A
   * password gets "Show"; anything else can put an action (Paste, Clear) at
   * the right through `action`.
   *
   * Every property the global `input` rule sets is reset on the inner input.
   */
  let {
    label,
    aside,
    hint,
    error = null,
    value = $bindable(),
    input = $bindable(),
    type = 'text',
    action,
    errorExtra,
    control,
    ...rest
  }: {
    label: string;
    /** Small text at the right of the label ("only if you turned it on"). */
    aside?: string;
    hint?: string;
    /** Shown under the field, and the field turns red. */
    error?: string | null;
    value?: string | null;
    input?: HTMLInputElement;
    type?: HTMLInputAttributes['type'];
    action?: Snippet;
    /** Rendered after the error text (a link that fixes it). */
    errorExtra?: Snippet;
    /** Replaces the input -- a <select> with this id, say -- in the same box. */
    control?: Snippet<[string]>;
  } & Omit<HTMLInputAttributes, 'value' | 'type'> = $props();

  // Stable across server render and hydration, unlike a random id.
  const id = $props.id();
  let shown = $state(false);
  const effective = $derived(type === 'password' && shown ? 'text' : type);
  const describedBy = $derived(error ? `${id}-err` : hint ? `${id}-hint` : undefined);
</script>

<div class="fld">
  <span class="lrow">
    <label class="lbl" for={id}>{label}</label>
    {#if aside}<span class="aside">{aside}</span>{/if}
  </span>
  <span class="box" class:bad={!!error}>
    {#if control}
      {@render control(id)}
    {:else}
    <input
      {id}
      bind:this={input}
      bind:value
      type={effective}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      {...rest}
    />
    {/if}
    {#if action}
      {@render action()}
    {:else if type === 'password'}
      <button type="button" class="act" aria-pressed={shown} onclick={() => (shown = !shown)}>{shown ? 'Hide' : 'Show'}</button>
    {/if}
  </span>
  {#if error}
    <span class="msg err" id="{id}-err" role="alert">{error}{#if errorExtra}{' '}{@render errorExtra()}{/if}</span>
  {:else if hint}
    <span class="msg" id="{id}-hint">{hint}</span>
  {/if}
</div>

<style>
  .fld {
    display: flex;
    flex-direction: column;
    gap: 6px;
    line-height: normal;
  }

  .lrow {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    padding: 0 2px;
  }

  .lbl {
    font-size: 14px;
    font-weight: 500;
    color: var(--ink-2);
  }

  .aside {
    font-size: 13px;
    color: var(--ink-3);
  }

  .box {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: var(--r-field);
    background: var(--surface);
    transition:
      border-color var(--step),
      box-shadow var(--step);
  }

  .box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .box.bad {
    border-color: var(--over);
    box-shadow: 0 0 0 3px var(--over-soft);
  }

  input {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    min-height: 0;
    height: auto;
    margin: 0;
    padding: 13px 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    outline: none;
    font: inherit;
    font-size: 16px;
    color: var(--ink);
    text-overflow: ellipsis;
  }

  input:focus {
    border: 0;
    box-shadow: none;
  }

  /* A <select> passed through `control` looks like the input, with its own
     caret at the right. */
  .box :global(select) {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    min-height: 0;
    height: auto;
    margin: 0;
    padding: 13px 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    outline: none;
    appearance: none;
    font: inherit;
    font-size: 16px;
    color: var(--ink);
    cursor: pointer;
  }

  .box:has(:global(select))::after {
    content: '▾';
    font-size: 15px;
    font-weight: 500;
    color: var(--ink-3);
    pointer-events: none;
  }

  input::placeholder {
    color: var(--ink-3);
    opacity: 1;
  }

  /* The action at the right: Show, Paste, Clear. Pages pass their own button
     with class "act" through `action` and get the same look. */
  .box :global(.act) {
    flex: 0 0 auto;
    min-height: 0;
    margin: 0;
    padding: 4px 0;
    border: 0;
    background: none;
    box-shadow: none;
    font: inherit;
    font-size: 15px;
    font-weight: 500;
    color: var(--ink-2);
    cursor: pointer;
  }

  .box :global(.act:hover) {
    background: none;
    color: var(--ink);
  }

  .box :global(.act.accent) {
    color: var(--accent-text);
  }

  .msg {
    padding: 0 2px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--ink-3);
    text-wrap: pretty;
  }

  .msg.err {
    font-size: 14px;
    color: var(--over-text);
  }

  .msg.err :global(a) {
    color: inherit;
    font-weight: 500;
    text-decoration: underline;
  }
</style>
