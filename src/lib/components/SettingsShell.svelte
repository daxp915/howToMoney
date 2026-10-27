<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';

  /**
   * Settings: a 220px list in three groups beside the page on
   * desktop -- Money (Connections, Categories, Rules), App, Account -- and
   * Sign out. On a phone the list is the Settings page itself and each item
   * is a pushed screen. A connection with a problem carries a yellow dot here,
   * on its row and on the avatar.
   */
  let { children }: { children: Snippet } = $props();

  const problem = $derived(!!page.data.connectionProblem);
  const admin = $derived(!!page.data.user?.isAdmin);
  const GROUPS = $derived([
    {
      label: 'Money',
      items: [
        { href: '/settings/connections', label: 'Connections', dot: problem },
        { href: '/settings/categories', label: 'Categories' },
        { href: '/settings/rules', label: 'Rules' }
      ]
    },
    {
      label: 'App',
      items: [
        { href: '/settings', label: 'Appearance' },
        { href: '/settings#privacy', label: 'Privacy' }
      ]
    },
    {
      label: 'Account',
      items: [
        { href: '/security', label: 'Security' },
        ...(admin ? [{ href: '/admin', label: 'People' }] : []),
        { href: '/help', label: 'Help' }
      ]
    }
  ]);

  const current = (href: string) => {
    const p = page.url.pathname;
    const h = href.split('#')[0];
    if (h === '/settings') return p === '/settings' && (href.includes('#') ? page.url.hash === '#privacy' : page.url.hash !== '#privacy');
    return p === h || p.startsWith(h + '/');
  };
</script>

<div class="shell">
  <nav class="side" aria-label="Settings">
    {#each GROUPS as g (g.label)}
      <div class="section-label">{g.label}</div>
      {#each g.items as it (it.href)}
        <a href={it.href} aria-current={current(it.href) ? 'page' : undefined}
          >{it.label}{#if 'dot' in it && it.dot}<span class="dot" aria-label="Needs you"></span>{/if}</a
        >
      {/each}
    {/each}
    <form method="POST" action="/logout" class="out">
      <button type="submit">Sign out</button>
    </form>
  </nav>
  <div class="content">{@render children()}</div>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 32px;
    align-items: start;
    line-height: normal;
  }

  .side {
    position: sticky;
    top: calc(var(--topbar-h) + 24px);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .side .section-label {
    margin: 18px 0 6px;
    padding: 0 12px;
    font-size: 11px;
  }

  .side .section-label:first-child {
    margin-top: 0;
  }

  .side a,
  .out button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 0;
    padding: 8px 12px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--ink-2);
    font: inherit;
    font-size: 15px;
    font-weight: 400;
    text-align: left;
    cursor: pointer;
  }

  .side a:hover,
  .out button:hover {
    background: var(--pill);
    color: var(--ink);
  }

  .side a[aria-current='page'] {
    background: var(--pill);
    color: var(--ink);
    font-weight: 500;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--watch);
  }

  .out {
    margin-top: 22px;
  }

  .out button {
    width: 100%;
  }

  .content {
    min-width: 0;
  }

  @media (max-width: 760px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
    }

    .side {
      display: none;
    }
  }
</style>
