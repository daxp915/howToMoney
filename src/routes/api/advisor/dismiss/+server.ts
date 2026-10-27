import { error, json } from '@sveltejs/kit';
import { dismissFinding, restoreFindings } from '$lib/server/advisor/facts';
import type { RequestHandler } from './$types';

/**
 * Puts a checkup finding away (`{ key }`), or back (`{ restore: [keys] }` --
 * the Undo pill and "N hidden · Show"). Keys carry their figure, so the same
 * finding with a new figure comes back on its own.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  const body = (await request.json().catch(() => ({}))) as { key?: unknown; restore?: unknown };
  if (Array.isArray(body.restore)) {
    const keys = body.restore.filter((k): k is string => typeof k === 'string' && k.length <= 200);
    await restoreFindings(keys);
    return json({ ok: true });
  }
  if (typeof body.key !== 'string' || !body.key || body.key.length > 200) throw error(400, 'No finding given.');
  await dismissFinding(body.key);
  return json({ ok: true });
};
