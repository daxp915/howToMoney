/**
 * Keyboard shortcut labels in the keyboard's own words: ⌘ on a Mac, Ctrl
 * everywhere else. Windows has no ⌘ key, so "⌘K" there reads as a shortcut
 * that does not exist.
 *
 * The handlers already accept either key (`e.metaKey || e.ctrlKey`); only the
 * hints differ. The platform is read in the browser after hydration (`init()`
 * from the root layout) -- the server cannot know it, and module state on the
 * server is shared by every request -- so the first paint says the Mac form.
 */
let mac = $state(true);

export const keys = {
  init() {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    mac = /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform ?? '');
  },
  get mac() {
    return mac;
  },
  /** "⌘K" / "Ctrl K"; "⌘↵" / "Ctrl Enter". */
  combo(key: string): string {
    if (mac) return `⌘${key === 'Enter' ? '↵' : key}`;
    return `Ctrl ${key}`;
  }
};
