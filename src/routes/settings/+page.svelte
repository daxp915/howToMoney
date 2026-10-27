<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { TABS } from '$lib/preferences';
  import { privacy } from '$lib/privacy.svelte';
  import Btn from '$lib/components/ui/Btn.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Section from '$lib/components/ui/Section.svelte';
  import SegmentedControl from '$lib/components/ui/SegmentedControl.svelte';
  import Toggle from '$lib/components/ui/Toggle.svelte';

  /**
   * Settings. On a phone this page is the list -- profile, Money,
   * App, Account, Sign out -- with each item a pushed screen. On desktop the
   * list sits beside it (SettingsShell) and this is the App page:
   * Appearance, Privacy, Sections, the Advisor's floor and tips.
   */
  let { data, form } = $props();

  // ---- sections (tab visibility) ---------------------------------------------
  const optional = TABS.filter((t) => !t.fixed);
  const fromPrefs = () => Object.fromEntries(optional.map((t) => [t.href, !data.preferences.hiddenTabs.includes(t.href)]));
  let shown = $state<Record<string, boolean>>(fromPrefs());
  $effect(() => {
    shown = fromPrefs();
  });
  async function saveTabs() {
    const body = new FormData();
    for (const t of optional) if (shown[t.href]) body.append('tab', t.href);
    await fetch('?/tabs', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } }).catch(() => {});
    await invalidateAll();
  }

  // ---- connection alert email ---------------------------------------------------
  // svelte-ignore state_referenced_locally
  let alertsOn = $state(data.alerts.on);
  async function saveAlerts(on: boolean) {
    const body = new FormData();
    body.append('on', on ? '1' : '0');
    await fetch('?/alerts', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } }).catch(() => {});
    await invalidateAll();
  }

  // ---- appearance: System (default), Light or Dark, kept on this device ----------
  let theme = $state<'system' | 'light' | 'dark'>('system');
  $effect(() => {
    try {
      const t = localStorage.getItem('theme');
      theme = t === 'light' || t === 'dark' ? t : 'system';
    } catch {
      theme = 'system';
    }
  });
  function setTheme(next: string) {
    theme = next as typeof theme;
    try {
      if (next === 'system') {
        delete document.documentElement.dataset.theme;
        localStorage.removeItem('theme');
      } else {
        document.documentElement.dataset.theme = next;
        localStorage.setItem('theme', next);
      }
    } catch {
      // Applies for this visit even if it cannot be stored.
    }
  }

  // ---- privacy: hide amounts, persisted in the existing cookie -------------------
  let hidden = $state(false);
  $effect(() => {
    hidden = privacy.hidden;
  });

  let floorText = $state('');
  $effect(() => {
    floorText = String(data.floor);
  });
  let floorForm = $state<HTMLFormElement | null>(null);

  const initials = $derived(
    (data.user?.email ?? '?')
      .split('@')[0]
      .split(/[._-]+/)
      .filter((w: string) => /^[a-z]/i.test(w))
      .slice(0, 2)
      .map((w: string) => w[0].toUpperCase())
      .join('') || '?'
  );
</script>

<svelte:head><title>Settings · HTMFD</title></svelte:head>

<div class="settings">
  <!-- The phone's list; desktop has it beside the page instead. -->
  <div class="menu">
    <div class="profile">
      <span class="av">{initials}</span>
      <div><div class="who">{data.user?.email?.split('@')[0]}</div><div class="mail">{data.user?.email}</div></div>
    </div>
    <Section label="Money">
      <Card>
        <a class="mrow" href="/settings/connections"
          ><span>Connections</span><span class="val"
            >{#if data.connectionProblem}<i class="dot"></i>needs you{:else}{data.counts.banks} bank{data.counts.banks === 1 ? '' : 's'}{/if} ›</span
          ></a
        >
        <a class="mrow" href="/settings/categories"><span>Categories</span><span class="val">{data.counts.categories} ›</span></a>
        <a class="mrow" href="/settings/rules"><span>Rules</span><span class="val">{data.counts.rules} ›</span></a>
      </Card>
    </Section>
    <Section label="Account">
      <Card>
        <a class="mrow" href="/security"
          ><span>Security</span><span class="val">{data.user?.totpEnabled ? '2-step on' : '2-step off'} ›</span></a
        >
        {#if data.counts.people !== null}
          <a class="mrow" href="/admin"><span>People</span><span class="val">{data.counts.people} ›</span></a>
        {/if}
        <a class="mrow" href="/help"><span>Help</span><span class="val">›</span></a>
      </Card>
    </Section>
  </div>

  <h1 class="desk-title">Appearance</h1>

  <Section label="Appearance">
    <Card pad="body">
      <div class="line">
        <div><div class="t">Theme</div><div class="s">System follows your device.</div></div>
        <div class="seg">
          <SegmentedControl
            label="Theme"
            items={[
              { key: 'system', label: 'System' },
              { key: 'light', label: 'Light' },
              { key: 'dark', label: 'Dark' }
            ]}
            value={theme}
            onselect={setTheme}
          />
        </div>
      </div>
    </Card>
  </Section>

  <section id="privacy">
    <Section label="Privacy">
      <Card pad="body">
        <div class="line">
          <div>
            <div class="t">Hide amounts on open</div>
            <div class="s">Shows $••• until you tap the eye. Press h anywhere to switch.</div>
          </div>
          <Toggle
            label="Hide amounts on open"
            bind:checked={hidden}
            onchange={(on) => {
              if (on !== privacy.hidden) privacy.toggle();
            }}
          />
        </div>
      </Card>
    </Section>
  </section>

  <Section label="Alerts">
    <Card pad="body">
      <div class="line">
        <div>
          <div class="t">Email me when a connection breaks</div>
          <div class="s">
            {#if data.alerts.configured}
              To {data.alerts.to}: once per problem, a reminder every 3 days, and once when it is fixed.
            {:else}
              Mail is not set up on this server yet, so nothing is sent.
            {/if}
          </div>
        </div>
        <Toggle label="Email me when a connection breaks" bind:checked={alertsOn} onchange={saveAlerts} />
      </div>
    </Card>
  </Section>

  <Section label="Sections">
    <Card>
      {#each optional as t (t.href)}
        <div class="line row">
          <div><div class="t">{t.label}</div>{#if t.description}<div class="s">{t.description}</div>{/if}</div>
          <Toggle label="Show {t.label}" bind:checked={shown[t.href]} onchange={saveTabs} />
        </div>
      {/each}
    </Card>
  </Section>

  <Section label="Advisor">
    <Card pad="body">
      <form
        bind:this={floorForm}
        method="POST"
        action="?/floor"
        use:enhance={() =>
          async ({ update }) => {
            await update({ reset: false });
          }}
        class="line"
      >
        <div>
          <div class="t">Keep in checking</div>
          <div class="s">
            The Advisor warns before {data.floorAccount ?? 'checking'} drops below this. $0 turns the warning off.
          </div>
          {#if form?.floorError}<div class="err">{form.floorError}</div>{/if}
        </div>
        <input
          class="floor"
          name="floor"
          inputmode="decimal"
          aria-label="Floor"
          bind:value={floorText}
          onblur={() => floorText.trim() !== String(data.floor) && floorForm?.requestSubmit()}
        />
      </form>
    </Card>
  </Section>

  <Section label="Tips">
    <Card pad="body">
      <form method="POST" action="?/replayTour" class="line">
        <div><div class="t">Show tips again</div><div class="s">Every one-time tip comes back once.</div></div>
        <Btn variant="secondary" size="sm" type="submit">Show again</Btn>
      </form>
    </Card>
  </Section>

  <form method="POST" action="/logout" class="signout">
    <button type="submit">Sign out</button>
  </form>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 720px;
    line-height: normal;
  }

  .menu {
    display: none;
  }

  .desk-title {
    margin: 0;
  }

  .profile {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .av {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--ink);
    color: var(--bg);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
  }

  .who {
    font-size: 17px;
    font-weight: 500;
  }

  .mail {
    font-size: 13px;
    color: var(--ink-3);
  }

  .mrow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    border-top: 1px solid var(--line);
    font-size: 16px;
    color: var(--ink);
  }

  .mrow:first-child {
    border-top: 0;
  }

  .val {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    color: var(--ink-3);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--watch);
  }

  .line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }

  .row {
    padding: 14px 20px;
    border-top: 1px solid var(--line);
  }

  .row:first-child {
    border-top: 0;
  }

  .t {
    font-size: 16px;
  }

  .s {
    margin-top: 2px;
    font-size: 13px;
    color: var(--ink-3);
  }

  .seg {
    width: 260px;
    flex: 0 0 auto;
  }

  .floor {
    width: 120px;
    flex: 0 0 auto;
    text-align: right;
    border-radius: var(--r-field);
    border-color: var(--line);
    background: var(--field);
  }

  .err {
    margin-top: 6px;
    font-size: 13px;
    color: var(--over-text);
  }

  .signout {
    display: none;
    justify-content: center;
  }

  .signout button {
    min-height: 0;
    border: 0;
    background: none;
    color: var(--ink-2);
    font: inherit;
    font-size: 15px;
    cursor: pointer;
  }

  @media (max-width: 760px) {
    .menu {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .desk-title {
      display: none;
    }

    .signout {
      display: flex;
    }

    .line {
      flex-wrap: wrap;
    }

    .seg {
      width: 100%;
    }
  }
</style>
