/**
 * Posts to a page's form action from code (a picker tile, a toggle) rather
 * than from a <form>, then refreshes the page's data. Returns the action's
 * result, or throws its message.
 */
import { invalidateAll } from '$app/navigation';
import { deserialize } from '$app/forms';

export async function act(
  action: string,
  fields: Record<string, string | string[]>,
  opts: { path?: string; refresh?: boolean } = {}
): Promise<Record<string, unknown>> {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const x of v) body.append(k, x);
    else body.append(k, v);
  }
  // A path that already has a query (`/plan?tab=goals`) takes the action as
  // one more parameter; a second `?` would fold it into the previous value and
  // SvelteKit would find no action name at all.
  const path = opts.path ?? '';
  const res = await fetch(`${path}${path.includes('?') ? '&' : '?'}/${action}`, {
    method: 'POST',
    body,
    headers: { 'x-sveltekit-action': 'true' }
  });
  const result = deserialize(await res.text());
  if (opts.refresh !== false) await invalidateAll();
  if (result.type === 'failure') throw new Error(String((result.data as { message?: string })?.message ?? 'That did not work.'));
  if (result.type === 'error') throw new Error(result.error?.message ?? 'That did not work.');
  return result.type === 'success' ? ((result.data as Record<string, unknown>) ?? {}) : {};
}
