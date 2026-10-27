// The browser's Sentry tunnel (hooks.client.ts `tunnel`). Takes an envelope
// from this origin and forwards it to the one Sentry project in SENTRY_DSN --
// never to a DSN named in the envelope, or this would be an open relay to any
// Sentry project on the internet. Public (hooks.server.ts PUBLIC_ROUTES) so an
// error on the sign-in page still arrives; the CSRF check still applies.
import type { RequestHandler } from './$types';

const MAX_BYTES = 1_000_000;

function target(): { host: string; projectId: string } | null {
  try {
    const dsn = new URL(process.env.SENTRY_DSN ?? '');
    const projectId = dsn.pathname.replace(/^\//, '');
    return projectId ? { host: dsn.host, projectId } : null;
  } catch {
    return null;
  }
}

export const POST: RequestHandler = async ({ request }) => {
  const to = target();
  if (!to) return new Response(null, { status: 204 });

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response(null, { status: 413 });

  // The first line of an envelope is its JSON header, which names the DSN.
  const text = new TextDecoder().decode(body.slice(0, Math.min(body.byteLength, 4096)));
  let header: { dsn?: string };
  try {
    header = JSON.parse(text.split('\n', 1)[0]);
  } catch {
    return new Response(null, { status: 400 });
  }
  try {
    const dsn = new URL(header.dsn ?? '');
    if (dsn.host !== to.host || dsn.pathname.replace(/^\//, '') !== to.projectId) {
      return new Response(null, { status: 403 });
    }
  } catch {
    return new Response(null, { status: 400 });
  }

  const res = await fetch(`https://${to.host}/api/${to.projectId}/envelope/`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-sentry-envelope' },
    signal: AbortSignal.timeout(10_000)
  }).catch(() => null);
  return new Response(null, { status: res?.ok ? 200 : 502 });
};
