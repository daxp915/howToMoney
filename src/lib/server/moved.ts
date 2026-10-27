import { redirect } from '@sveltejs/kit';

/**
 * v2 folded thirteen tabs into four places (see TABS in $lib/preferences).
 * Every old route keeps a stub that sends a bookmark, an autocomplete or a
 * link in an old Advisor answer to where its content went. 303 rather than a
 * permanent redirect: browsers cache 301s indefinitely, and these targets may
 * still move while the redesign settles.
 *
 * `extra` is merged into the old query string, so /budgets?month=2026-09
 * arrives as /plan?month=2026-09.
 */
export function moved(url: URL, to: string, extra: Record<string, string> = {}): never {
  const q = new URLSearchParams(url.search);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  throw redirect(303, s ? `${to}?${s}` : to);
}
