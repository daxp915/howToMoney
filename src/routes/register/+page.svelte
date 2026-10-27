<script lang="ts">
  import '../../app.css';
  import { enhance } from '$app/forms';
  import { tick } from 'svelte';
  import AuthShell from '$lib/components/AuthShell.svelte';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Field from '$lib/components/ui/Field.svelte';
  import { MIN_PASSWORD } from '$lib/passwords';
  import { useCountdown } from '$lib/countdown.svelte';

  /**
   * Create account: by invite, so the code comes first (prefilled
   * from a /register?code= link), then email and one password with Show.
   * Each error sits under the field it is about and the cursor goes back
   * there; values survive a failed attempt.
   */
  let { data, form } = $props();

  let formEl = $state<HTMLFormElement>();
  const wait = useCountdown(() => form?.retryAfter ?? 0);
  const err = (f: string) => (form?.field === f ? form.message : null);

  async function settle() {
    await tick();
    if (form?.field) formEl?.querySelector<HTMLInputElement>(`[name="${form.field}"]`)?.focus();
  }
</script>

<svelte:head><title>Create your account · HTMFD</title></svelte:head>

<AuthShell>
  <div class="a-head">
    <h1 class="a-title">Create your account</h1>
    <p class="a-lede">Next, you connect a bank. It takes about two minutes.</p>
  </div>

  {#if form?.message && !form.field && !form.retryAfter}
    <p class="a-alert" role="alert">{form.message}</p>
  {/if}

  <form
    class="a-form"
    method="POST"
    bind:this={formEl}
    use:enhance={() =>
      async ({ update }) => {
        await update({ reset: false });
        await settle();
      }}
  >
    <Field
      label="Invite code"
      name="code"
      value={form?.code ?? data.code}
      placeholder="HTM-XXXXX-XXXXX-XXXXX"
      autocapitalize="characters"
      autocomplete="off"
      spellcheck="false"
      required
      error={err('code')}
    />
    <Field label="Email" name="email" type="email" autocomplete="username" required value={form?.email ?? ''} error={err('email')} />
    <Field
      label="Password"
      name="password"
      type="password"
      autocomplete="new-password"
      placeholder="Choose a password"
      required
      error={err('password')}
      hint={form?.retryAfter ? undefined : `At least ${MIN_PASSWORD} characters. A short sentence you'll remember works well.`}
    />

    {#if form?.retryAfter}
      <p class="a-alert" role="alert"><b>Too many attempts.</b> Wait a few seconds and try again. Nothing you typed is lost.</p>
    {/if}

    <Btn variant="primary" full type="submit" class="a-submit" disabled={wait.left > 0}>
      {wait.left > 0 ? `Try again in ${wait.label}` : 'Create account'}
    </Btn>
  </form>

  {#snippet foot()}Already have an account? <a href="/login">Log in</a>{/snippet}
</AuthShell>
