<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { privacy } from '$lib/privacy.svelte';
  import { sync } from '$lib/sync.svelte';
  import NoBank from '$lib/components/NoBank.svelte';
  import ConnectionAlert from '$lib/components/ConnectionAlert.svelte';
  import { visibleTabs } from '$lib/preferences';
  import Icon from '$lib/components/Icon.svelte';
  import Toast from '$lib/components/ui/Toast.svelte';
  import AdvisorPanel from '$lib/components/advisor/AdvisorPanel.svelte';
  import { advisor } from '$lib/advisor.svelte';
  import { keys } from '$lib/keys.svelte';

  let { children, data } = $props();

  // The server already decided this from the cookie and wrote it onto <html>;
  // read it back so the tooltip strings agree with what the CSS is doing.
  $effect(() => privacy.init());

  // A sync started in another tab, or before a reload, shows as running here.
  $effect(() => {
    if (chrome) sync.resume();
  });

  /**
   * Two shortcuts. `h` hides every amount -- one key, because the point is to
   * beat somebody walking up behind you -- and is ignored while typing so it
   * cannot fire into a search box. ⌘K / Ctrl+K opens the Advisor from
   * anywhere, which is what makes it a layer rather than a tab.
   */
  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && advisorOn) {
      e.preventDefault();
      advisor.toggle();
      return;
    }
    // Esc closes the desktop panel (the phone's sheet handles its own).
    if (e.key === 'Escape' && advisor.open && !e.defaultPrevented) {
      advisor.hide();
      return;
    }
    if (e.key !== 'h' || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName ?? '')) return;
    e.preventDefault();
    privacy.toggle();
  }

  // The catalogue lives in $lib/preferences so the settings page, the nav and
  // the route guard cannot drift apart.
  const tabs = $derived(visibleTabs(data?.preferences?.hiddenTabs ?? []));
  const places = $derived(tabs.filter((t) => !t.layer));
  const advisorOn = $derived(tabs.some((t) => t.href === '/advisor'));

  // Shortcut hints name the key this keyboard has ($lib/keys).
  $effect(() => keys.init());

  // During the guided setup every other page redirects back here, so chrome
  // full of them would be a wall of dead ends.
  const chrome = $derived(!!data?.user && !page.url.pathname.startsWith('/welcome'));

  // Pages that are nothing but numbers. With no account linked they would each
  // render their own grid of zeroes, which reads as a broken app rather than an
  // unfinished setup. The pages that can *fix* it -- Settings > Connections --
  // and the ones that work without data are deliberately not in this list.
  const MONEY_PAGES = ['/transactions', '/plan', '/wealth'];

  const blank = $derived(
    !!data?.user && data.hasAccounts === false && MONEY_PAGES.includes(page.url.pathname)
  );

  const isActive = (href: string) =>
    href === '/'
      ? page.url.pathname === '/'
      : page.url.pathname === href || page.url.pathname.startsWith(href + '/');

  /** The phone header names the place you are in; a page deeper than the four
   *  places is named for the place it belongs to. */
  const title = $derived.by(() => {
    const p = page.url.pathname;
    if (p.startsWith('/settings') || p === '/security' || p === '/help' || p === '/admin')
      return 'Settings';
    if (p.startsWith('/advisor')) return 'Advisor';
    return places.find((t) => isActive(t.href))?.label ?? '';
  });
  /** A page inside Settings is a pushed screen on a phone: its
   *  header is the way back, and the page's own title follows. */
  const pushed = $derived(page.url.pathname.startsWith('/settings/') || ['/security', '/help', '/admin'].includes(page.url.pathname));

  /** No name on the account, so the avatar is the email's first letter
   * : guessing two initials from "alex.p@" read as a stranger's. */
  const avatar = $derived((data?.user?.email?.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase());

  /** The Advisor opens over the screen you are on, not instead of it. */
  function ask(q = '', send = false) {
    advisor.show(q, send);
  }

  // Any link to the Advisor page with a question (an action button, an empty
  // state's "Ask the Advisor") opens the layer instead and asks it. The page
  // itself stays for History and for links without a question.
  function onClick(e: MouseEvent) {
    if (!advisorOn || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = (e.target as HTMLElement | null)?.closest?.('a[href^="/advisor?"]') as HTMLAnchorElement | null;
    if (!a) return;
    const u = new URL(a.href);
    if (u.searchParams.get('view') !== 'ask') return;
    e.preventDefault();
    const q = u.searchParams.get('q') ?? '';
    ask(q, !!q);
  }

  /** What the Advisor is told it is looking at, and what it offers to answer. */
  const monthName = new Date().toLocaleDateString('en-US', { month: 'long' });
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const screen = $derived.by(() => {
    const p = page.url.pathname;
    if (p === '/')
      return {
        context: `Home · ${today}`,
        suggestions: [
          'Am I on pace this month?',
          "What's due before payday?",
          data.reviewCount ? `Should I review these ${data.reviewCount} now?` : 'What should I keep an eye on?'
        ]
      };
    if (p.startsWith('/transactions'))
      return {
        context: `Activity · ${monthName}`,
        suggestions: ['Where did most of my money go this month?', 'What changed from last month?', 'Anything unusual lately?']
      };
    if (p.startsWith('/plan'))
      return {
        context: `Plan · ${monthName}`,
        suggestions: ['Can I afford a $400 trip this month?', 'Where can I cut back?', 'Am I on track for my goals?']
      };
    if (p.startsWith('/wealth'))
      return {
        context: 'Wealth',
        suggestions: ['How are my investments doing?', 'When will my loans be paid off?', 'How much should I keep in savings?']
      };
    return { context: title || 'HTMFD', suggestions: ['How am I doing this month?'] };
  });
</script>

<!-- Capture phase: SvelteKit's router handles link clicks on the way down
     and prevents the default, so a bubbling listener only ever saw clicks
     already turned into a navigation to the full Advisor page. -->
<svelte:window onkeydown={onKey} onclickcapture={onClick} />

{#snippet eye()}
  <button
    class="round"
    class:on={privacy.hidden}
    onclick={() => privacy.toggle()}
    type="button"
    aria-pressed={privacy.hidden}
    aria-label={privacy.hidden ? 'Show amounts' : 'Hide amounts'}
    title={(privacy.hidden ? 'Show amounts' : 'Hide amounts') + ' (h)'}
  >
    <Icon name={privacy.hidden ? 'eye-off' : 'eye'} size={20} stroke={1.75} />
  </button>
{/snippet}

{#snippet avatarLink()}
  <a
    class="round avatar"
    href="/settings"
    aria-label="Settings"
    aria-current={title === 'Settings' ? 'page' : undefined}
    >{avatar}{#if data.connectionProblem}<span class="pdot" aria-label="A connection needs you"></span>{/if}</a
  >
{/snippet}

{#if chrome}
  <!-- Desktop: one 72px bar. The sidebar it replaced held four places and a
       lot of empty height; this gives that width back to the content. -->
  <header class="topbar">
    <a class="brandmark" href="/">HTMFD</a>
    <nav class="places" aria-label="Main">
      {#each places as t (t.href)}
        <a href={t.href} aria-current={isActive(t.href) ? 'page' : undefined}>
          {t.label}
          {#if t.href === '/' && data.reviewCount}<span class="badge">{data.reviewCount}</span>{/if}
        </a>
      {/each}
    </nav>
    {#if advisorOn}
      <button class="askbar" class:on={advisor.open} type="button" onclick={() => advisor.toggle()}>
        <span class="dot" aria-hidden="true"></span>
        <span class="ask-text">{advisor.open ? 'Advisor open' : 'Ask about your money…'}</span>
        <kbd>{keys.combo('K')}</kbd>
      </button>
    {/if}
    <div class="actions" class:alone={!advisorOn}>
      {@render eye()}
      <button
        class="round"
        class:spinning={sync.running}
        type="button"
        onclick={() => sync.start()}
        disabled={sync.running}
        aria-label={sync.running ? 'Syncing' : 'Sync now'}
        title={sync.running ? 'Syncing…' : 'Sync now'}
      >
        <Icon name="sync" size={18} stroke={1.75} />
      </button>
      {@render avatarLink()}
    </div>
  </header>

  <!-- Phone: the place's name, the eye and the avatar. Not sticky, as drawn. -->
  <header class="phonehead">
    <!-- No way out while a password change is forced: every route but
         /security and /logout redirects back, so the link would read as broken. -->
    {#if pushed && data?.user?.mustChangePassword}<span class="phone-title">{title}</span>{:else if pushed}<a class="phone-back" href="/settings">‹ Settings</a>{:else}<span class="phone-title">{title}</span>{/if}
    {@render eye()}
    {@render avatarLink()}
  </header>

  <main class="main" class:pushed>
    <!-- Connections lists every issue as a card of its own. -->
    {#if !page.url.pathname.startsWith('/settings/connections')}
      {#key data.connectionIssues.map((x) => x.key).join()}
        <ConnectionAlert issues={data.connectionIssues} snoozed={data.connectionSnoozed} />
      {/key}
    {/if}
    {#if sync.error || sync.note}
      <div class="syncmsg" class:error={!!sync.error} role="status">
        <span>{sync.error ?? sync.note}</span>
        <button type="button" class="ghost" onclick={() => sync.dismiss()} aria-label="Dismiss">
          <Icon name="close" size={16} />
        </button>
      </div>
    {/if}
    {#if blank}
      <div class="nobank">
        <NoBank
          unit={page.url.pathname.startsWith('/plan')
            ? 'to assign'
            : page.url.pathname.startsWith('/wealth')
              ? 'net worth'
              : 'out'}
        />
      </div>
    {:else}
      {@render children()}
    {/if}
  </main>

  <!-- Phone: four places and Ask in the middle. Nothing scrolls sideways and
       nothing hides behind a More sheet. -->
  <nav
    class="bottombar"
    aria-label="Main"
    style="grid-template-columns: repeat({places.length + (advisorOn ? 1 : 0)}, minmax(0, 1fr))"
  >
    {#each places as t, i (t.href)}
      {#if advisorOn && i === 2}
        <button class="ask" type="button" onclick={() => ask()} aria-label="Ask the Advisor">
          <span>Ask</span>
        </button>
      {/if}
      <a href={t.href} aria-current={isActive(t.href) ? 'page' : undefined}>
        <span class="glyph">
          <Icon name={t.icon} size={22} stroke={isActive(t.href) ? 2.25 : 1.75} />
          {#if t.href === '/' && data.reviewCount}<span class="badge">{data.reviewCount}</span>{/if}
        </span>
        {t.label}
      </a>
    {/each}
    {#if advisorOn && places.length <= 2}
      <button class="ask" type="button" onclick={() => ask()} aria-label="Ask the Advisor">
        <span>Ask</span>
      </button>
    {/if}
  </nav>

  <Toast />
  {#if advisorOn}<AdvisorPanel context={screen.context} suggestions={screen.suggestions} />{/if}
{:else}
  {@render children()}
{/if}

<style>
  /* ---- desktop top bar ---- */

  .topbar {
    position: sticky;
    top: 0;
    z-index: 30;
    height: var(--topbar-h);
    padding: 0 40px;
    display: flex;
    align-items: center;
    gap: 32px;
    background: var(--appbar-blur-bg);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--line);
    line-height: normal;
  }

  .brandmark {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
  }

  .places {
    display: flex;
    gap: 4px;
    font-size: 15px;
    font-weight: 500;
  }

  .places a {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: var(--r-pill);
    color: var(--ink-2);
    transition:
      background var(--step),
      color var(--step);
  }

  .places a:hover {
    background: var(--pill);
    color: var(--ink);
  }

  .places a[aria-current='page'] {
    background: var(--nav-on);
    color: var(--nav-on-ink);
  }

  .badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: var(--r-pill);
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* Resets every property the global `button` rule sets. */
  .askbar {
    flex: 1 1 0%;
    max-width: 520px;
    margin-left: auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    padding: 10px 18px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--surface);
    box-shadow: var(--shadow);
    font-size: 15px;
    font-weight: 400;
    color: var(--ink-3);
    text-align: left;
  }

  .askbar.on {
    color: var(--accent-text);
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }

  .askbar:hover {
    background: var(--surface);
    color: var(--ink-2);
  }

  .askbar:active {
    transform: none;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    flex: 0 0 auto;
  }

  .ask-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  kbd {
    margin-left: auto;
    font: 500 12px var(--font-mono);
    color: var(--ink-3);
  }

  .actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .actions.alone {
    margin-left: auto;
  }

  .round {
    width: 40px;
    height: 40px;
    min-height: 0;
    padding: 0;
    flex: 0 0 auto;
    border: 0;
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--ink);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .round:hover {
    background: var(--pill);
  }

  .round.on {
    background: var(--nav-on);
    color: var(--nav-on-ink);
  }

  .round:disabled {
    opacity: 1;
    cursor: progress;
  }

  .spinning :global(svg) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .avatar {
    background: var(--track);
    box-shadow: none;
    font-size: 14px;
    font-weight: 600;
  }

  .avatar {
    position: relative;
  }

  .pdot {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--watch);
    box-shadow: 0 0 0 2px var(--bg);
  }

  .avatar[aria-current='page'] {
    box-shadow: 0 0 0 2px var(--accent);
  }

  /* ---- content ---- */

  .main {
    max-width: var(--content-max);
    margin: 0 auto;
    padding: 40px 40px 56px;
    width: 100%;
    min-width: 0;
  }

  .nobank {
    max-width: 560px;
    margin: 0 auto;
  }

  .syncmsg {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: var(--space-4);
    padding: 10px 10px 10px 16px;
    border-radius: var(--r-field);
    background: var(--watch-soft);
    color: var(--watch-text);
    font-size: var(--fs-meta);
    line-height: normal;
  }

  .syncmsg.error {
    background: var(--over-soft);
    color: var(--over-text);
  }

  .syncmsg button {
    min-height: 32px;
    padding: 0 8px;
    color: inherit;
  }

  /* ---- phone ---- */

  .phonehead,
  .bottombar {
    display: none;
  }

  @media (max-width: 760px) {
    .topbar {
      display: none;
    }

    .phonehead {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 20px 0;
      line-height: normal;
    }

    .phone-title {
      flex: 1 1 0%;
      font-size: var(--fs-title);
      font-weight: 500;
      letter-spacing: var(--ls-title);
    }

    /* "‹ Settings" over a pushed screen; the page title sits 4px under it. */
    .phone-back {
      flex: 1 1 0%;
      font-size: 15px;
      color: var(--accent-text);
      text-decoration: none;
    }

    .main.pushed {
      padding-top: 4px;
    }

    .main {
      padding: 20px 16px calc(110px + env(safe-area-inset-bottom));
    }

    .bottombar {
      display: grid;
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      align-items: center;
      padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
      background: var(--appbar-blur-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-top: 1px solid var(--line);
      text-align: center;
      font-size: 11px;
      font-weight: 500;
      line-height: normal;
    }

    .bottombar a {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      color: var(--ink-3);
      min-width: 0;
    }

    .bottombar a[aria-current='page'] {
      color: var(--ink);
    }

    .glyph {
      position: relative;
      display: flex;
    }

    .glyph .badge {
      position: absolute;
      top: -6px;
      left: 14px;
    }

    .ask {
      justify-self: center;
      width: 52px;
      height: 52px;
      min-height: 0;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: var(--accent);
      color: var(--accent-ink);
      font-size: 14px;
      font-weight: 600;
    }

    .ask:hover {
      background: var(--accent-hover);
    }
  }
</style>
