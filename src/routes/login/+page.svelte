<script lang="ts">
  import '../../app.css';
  import { enhance } from '$app/forms';
  import { tick } from 'svelte';
  import AuthShell from '$lib/components/AuthShell.svelte';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Field from '$lib/components/ui/Field.svelte';
  import { useCountdown } from '$lib/countdown.svelte';
  import { page } from '$app/state';

  /**
   * Log in. Email and password; the authenticator code appears only
   * once the server says this account needs one, so the screen is the mock's
   * two fields for everybody else. After a wrong password the email stays and
   * the password is cleared and focused (handoff 4b).
   */
  let { form } = $props();

  let password = $state<HTMLInputElement>();
  let totp = $state<HTMLInputElement>();
  const wait = useCountdown(() => form?.retryAfter ?? 0);
  const askCode = $derived(!!form?.needsTotp);

  async function settle() {
    await tick();
    if (form?.field === 'password' && password) {
      password.value = '';
      password.focus();
    } else if (form?.field === 'totp') {
      totp?.focus();
    }
  }
</script>

<svelte:head><title>Log in · HTMFD</title></svelte:head>

<AuthShell>
  <div class="a-head"><h1 class="a-title">Welcome back</h1></div>
  {#if page.url.searchParams.get('deleted') === '1' && !form}
    <p class="a-alert" role="status"><b>Your account is deleted.</b> Everything in it is gone, and your banks are disconnected.</p>
  {/if}

  <form
    class="a-form"
    method="POST"
    use:enhance={() =>
      async ({ update }) => {
        await update({ reset: false });
        await settle();
      }}
  >
    <Field label="Email" name="email" type="email" autocomplete="username" required value={form?.email ?? ''} />
    <Field
      label="Password"
      name="password"
      type="password"
      autocomplete="current-password"
      required
      bind:input={password}
      error={form?.field === 'password' ? form.message : null}
    />
    {#if askCode}
      <Field
        label="Authenticator code"
        aside="from your app"
        name="totp"
        inputmode="numeric"
        autocomplete="one-time-code"
        placeholder="123456"
        bind:input={totp}
        error={form?.field === 'totp' ? form.message : null}
      />
    {/if}

    {#if form?.retryAfter}
      <p class="a-alert" role="alert"><b>Too many attempts.</b> Wait a few seconds and try again. Nothing you typed is lost.</p>
    {/if}

    <Btn variant="primary" full type="submit" class="a-submit" disabled={wait.left > 0}>
      {wait.left > 0 ? `Try again in ${wait.label}` : 'Log in'}
    </Btn>
  </form>

  {#snippet foot()}New here? <a href="/register">Create an account</a>{/snippet}
</AuthShell>
