/**
 * "Hide the numbers" — a glance-proof toggle for a screen somebody else can see.
 *
 * The masking itself is CSS: every figure is wrapped in `.amt`, and the
 * `data-hide-amounts` attribute on <html> swaps each for the literal "$•••".
 * That attribute is written by the server from a cookie (see hooks.server.ts),
 * so a masked session renders
 * masked in the very first byte of HTML -- there is no window where the real
 * numbers are on screen waiting for JavaScript to hide them.
 *
 * This module is only for the strings CSS cannot reach: SVG <title> tooltips and
 * aria-labels, where the amount is text content rather than a styled element.
 * The state deliberately starts `false` on the server and is read from the DOM
 * after hydration: module-level state on the server is shared by every request,
 * so a per-user preference must never live there.
 */
import { money } from './format';

export const COOKIE = 'htm_hide_amounts';
// The literal text v2 shows for every hidden figure: same width whatever the
// amount, so the mask never gives away how many digits it has.
const MASK = '$•••';

let hidden = $state(false);

export const privacy = {
  get hidden() {
    return hidden;
  },

  /** Reads what the server already decided, after hydration. */
  init() {
    try {
      hidden = document.documentElement.dataset.hideAmounts === '1';
    } catch {
      hidden = false;
    }
  },

  toggle() {
    hidden = !hidden;

    // The attribute is what the CSS keys off, so flip it first: the change is
    // visible before anything else happens.
    if (hidden) document.documentElement.dataset.hideAmounts = '1';
    else delete document.documentElement.dataset.hideAmounts;

    // A cookie rather than localStorage, because the server has to know before
    // it renders. Per browser, which is what "per device" means in practice.
    // Lax matches the session cookie; this is a display preference, but there is
    // no reason to send it cross-site either.
    try {
      const year = 60 * 60 * 24 * 365;
      document.cookie =
        `${COOKIE}=${hidden ? '1' : '0'}; Path=/; Max-Age=${year}; SameSite=Lax` +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch {
      // The toggle still works for this page; it just will not be remembered.
    }
  }
};

/** A currency figure for somewhere CSS cannot reach -- a tooltip, an aria-label. */
export function maskedMoney(value: number | string | null | undefined): string {
  return hidden ? MASK : money(value);
}

/** Any already-formatted string that happens to contain a figure. */
export function maskText(text: string): string {
  return hidden ? MASK : text;
}
