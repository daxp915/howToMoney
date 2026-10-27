import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import { EMAIL_KINDS, emailFixture, type EmailKind } from '$lib/emailFixtures';
import type { RequestHandler } from './$types';

/**
 * One email drawn from fixtures, for looking at in a browser while working on
 * `$lib/email`: /dev/email/new-one, …/report (`EMAIL_KINDS`), `?text` for the
 * text part. Development only -- a production build answers 404.
 */
export const GET: RequestHandler = ({ params, url }) => {
  if (!dev) error(404, 'Not found');
  const kind = params.kind as EmailKind;
  if (!EMAIL_KINDS.includes(kind)) error(404, `Kinds: ${EMAIL_KINDS.join(', ')}`);
  const m = emailFixture(kind, new Date(), { assetBase: '/dev/email/img/' });
  return url.searchParams.has('text')
    ? new Response(`Subject: ${m.subject}\n\n${m.text}`, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    : new Response(m.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
};
