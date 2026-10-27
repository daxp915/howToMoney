<script lang="ts">
  import Field from '$lib/components/ui/Field.svelte';
  import { SIMPLEFIN_URL } from '$lib/simplefin';

  /**
   * The SimpleFIN setup-token field on the shared Field: Paste
   * while empty, Clear once filled. A rejected token shows the reason under
   * the field, ending in a link to make a new token when that is the fix.
   * Editing the token clears the error until the next answer.
   */
  let {
    value = $bindable(''),
    error = null,
    autofocus = false
  }: {
    value?: string;
    /** The action's answer; a new object per answer, so a repeat re-shows. */
    error?: { message: string; newToken: boolean } | null;
    autofocus?: boolean;
  } = $props();

  let input: HTMLInputElement | undefined = $state();
  let edited = $state(false);
  const shown = $derived(error && !edited ? error : null);
  // Reading the clipboard needs a secure context; without one the button
  // would do nothing, so it is only offered where it can work.
  let canPaste = $state(false);
  $effect(() => {
    canPaste = !!navigator.clipboard?.readText && window.isSecureContext;
  });
  $effect(() => {
    if (autofocus) input?.focus();
  });
  $effect(() => {
    void error;
    edited = false;
  });

  async function paste() {
    try {
      value = (await navigator.clipboard.readText()).trim();
      edited = true;
    } catch {
      input?.focus();
    }
  }
</script>

<Field
  label="Setup token"
  name="token"
  placeholder="Paste your token"
  autocomplete="off"
  autocapitalize="off"
  spellcheck="false"
  bind:value
  bind:input
  oninput={() => (edited = true)}
  error={shown?.message ?? null}
>
  {#snippet action()}
    {#if value}
      <button type="button" class="act" onclick={() => ((value = ''), (edited = true), input?.focus())}>Clear</button>
    {:else if canPaste}
      <button type="button" class="act accent" onclick={paste}>Paste</button>
    {/if}
  {/snippet}
  {#snippet errorExtra()}
    {#if shown?.newToken}<a href={SIMPLEFIN_URL} target="_blank" rel="noreferrer noopener">create a new one at SimpleFIN ↗</a>{/if}
  {/snippet}
</Field>
