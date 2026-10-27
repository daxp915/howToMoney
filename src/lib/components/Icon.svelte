<script lang="ts">
  /**
   * One stroked icon set, drawn at 24 and scaled down.
   *
   * The app used typographic glyphs -- ◎ ≡ ⚑ ⚯ -- which render in whatever the
   * system font decides, at whatever weight it fancies, and look like a 2010
   * admin panel next to any real interface. These are 1.75px strokes on a
   * shared 24-unit grid in currentColor, so they inherit text colour, stay
   * crisp at any size, and match each other.
   */
  let {
    name,
    size = 20,
    stroke = 1.75
  }: { name: string; size?: number; stroke?: number } = $props();

  // `d` attributes only: no fills, no per-icon viewBox, nothing to keep in step.
  const PATHS: Record<string, string> = {
    dashboard: 'M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z',
    transactions: 'M4 7h16M4 12h16M4 17h10',
    review: 'M5 21V5a2 2 0 0 1 2-2h9l-1.5 4L16 11H7a2 2 0 0 0-2 2',
    cashflow: 'M3 8h13l-3-3m3 3-3 3M21 16H8l3-3m-3 3 3 3',
    budgets: 'M4 5h16v14H4zM4 10h16M10 10v9',
    goals: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    recurring: 'M4 11a8 8 0 0 1 14-5m2 7a8 8 0 0 1-14 5M18 3v3.5h-3.5M6 21v-3.5h3.5',
    categories: 'M3 12a9 9 0 1 1 9 9m0-9 7-6M12 21V12',
    rules: 'M4 6h16M7 12h10M10 18h4',
    import: 'M12 16V4m0 0L7 9m5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2',
    connect: 'M9 15 4.8 19.2a3 3 0 0 1-4.2-4.2M15 9l4.2-4.2a3 3 0 0 1 4.2 4.2M9 15l6-6',
    link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
    settings:
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.2-1.7l2-1.5-2-3.4-2.3 1a8 8 0 0 0-3-1.7L14 2h-4l-.5 2.7a8 8 0 0 0-3 1.7l-2.3-1-2 3.4 2 1.5a8 8 0 0 0 0 3.4l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 3 1.7L10 22h4l.5-2.7a8 8 0 0 0 3-1.7l2.3 1 2-3.4-2-1.5c.1-.6.2-1.1.2-1.7Z',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.2-11a2.3 2.3 0 1 1 3.2 2c-.6.4-1 1-1 1.7v.3m0 3h.01',
    security: 'M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3Zm0 7v4',
    users: 'M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-1.5a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'eye-off': 'M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.3A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3.3 4.1M6.2 6.7A17.4 17.4 0 0 0 2 12s3.6 7 10 7c1.2 0 2.3-.2 3.3-.6',
    theme: 'M12 3a9 9 0 1 0 0 18V3Zm0 0a9 9 0 0 1 0 18',
    logout: 'M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    sync: 'M20 11a8 8 0 0 0-13.7-5.3L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 13.7 5.3L21 15m0 0v5m0-5h-5',
    grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
    up: 'M12 19V5m0 0-6 6m6-6 6 6',
    down: 'M12 5v14m0 0 6-6m-6 6-6-6',
    trend: 'M3 17l6-6 4 4 8-8m0 0h-5m5 0v5',
    wallet: 'M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm13 4h3v3h-3a1.5 1.5 0 0 1 0-3Z',
    card: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm0 3h18',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2',
    check: 'M4 12.5 9.5 18 20 6',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6 6 18',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
    // Three zero-length strokes: round caps draw them as dots, sized by `stroke`.
    ellipsis: 'M5 12h.01M12 12h.01M19 12h.01',
    chevron: 'm9 6 6 6-6 6',
    envelope: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 .5 9 6 9-6',
    alert: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 8v4M12 16h.01',
    lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7Z',
    clipboard:
      'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm7 2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
    external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    refresh:
      'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
    tag: 'M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4ZM7.5 7.5h.01',
    // Lucide, for the phone's More sheet (handoff 7p).
    'wallet-l':
      'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
    target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-4a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    'trending-up': 'M22 7 13.5 15.5 8.5 10.5 2 17M16 7h6v6',
    banknote: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm8 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 12h.01M18 12h.01',
    repeat: 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
    'list-checks': 'm3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8',
    landmark: 'M10 18v-7M14 18v-7M18 18v-7M6 18v-7M3 22h18M12 2l8 4.5V8H4V6.5Z',
    'settings-2': 'M14 17H5M19 7h-9M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    compass:
      'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm4.24-14.24-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z',
    history: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2',
    trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    'arrow-up': 'm5 12 7-7 7 7M12 19V5',
    ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM4.93 4.93l14.14 14.14',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
    back: 'm15 18-6-6 6-6',
    'chevron-down': 'm6 9 6 6 6-6',
    pencil:
      'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'
  };

  const d = $derived(PATHS[name] ?? PATHS.dashboard);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  <path {d} />
</svg>
