import { error, redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import { SESSION_COOKIE, validateSession } from '$lib/server/auth';
import { COOKIE as PRIVACY_COOKIE } from '$lib/privacy.svelte';
import { runAsUser } from '$lib/server/db';

// /api/monitoring is the browser's Sentry tunnel; it touches no tenant data.
// /api/plaid/webhook is Plaid's server calling, authenticated by its signature.
const PUBLIC_ROUTES = new Set(['/login', '/health', '/register', '/api/monitoring', '/api/plaid/webhook']);

// Server-to-server POSTs carry no Origin, so the origin check cannot apply.
// Each authenticates itself instead -- the Plaid webhook by a signed JWT over
// its body (`$lib/server/plaid/webhook`). Nothing a browser posts belongs here.
const ORIGIN_EXEMPT = new Set(['/api/plaid/webhook']);

// Reachable while an account still holds an admin-chosen password: the page
// that replaces it, and the way back out. Everything else redirects, so a
// temporary password cannot quietly become a permanent one.
const PASSWORD_CHANGE_ROUTES = new Set(['/security', '/logout']);

// Reachable before the guided setup is finished. Everything else redirects into
// it: an account with no bank connected has nothing to show, and a dashboard of
// empty tables tells a new person nothing about what to do next.
const SETUP_ROUTES = new Set(['/welcome', '/security', '/logout']);
// Connecting a bank with Plaid happens *during* setup, from /welcome, through
// these endpoints. Redirecting them too handed Link the welcome page's HTML
// where it expected JSON ("Unexpected token '<'"), found on a fresh account.
const SETUP_API_PREFIX = '/api/plaid/';

// Origins allowed to submit forms. ORIGIN is what adapter-node serves under;
// TRUSTED_ORIGINS adds any others (a LAN address used alongside the public
// hostname, for instance) as a comma-separated list.
const trustedOrigins = new Set(
  [process.env.ORIGIN, ...(process.env.TRUSTED_ORIGINS ?? '').split(',')]
    .map((o) => (o ?? '').trim().replace(/\/$/, ''))
    .filter(Boolean)
);

// Every method that can change state. Content-type is deliberately not part of
// the test: a cross-site `fetch('/api/sync', { method: 'POST' })` sends no
// content-type at all, so filtering on the three form encodings let exactly the
// requests an HTML form cannot make through unchecked. SameSite=Lax already
// withholds the session cookie there, but the origin check should not be the
// layer that depends on it.
function isUnsafeMethod(request: Request): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
}

const app: Handle = async ({ event, resolve }) => {
  // Stands in for SvelteKit's own CSRF check (disabled in svelte.config.js).
  // Same rule -- a form POST must come from an origin we serve -- but a
  // rejection says which origin was seen and what was expected, instead of a
  // bare "Cross-site POST form submissions are forbidden" with no detail.
  if (isUnsafeMethod(event.request) && !ORIGIN_EXEMPT.has(event.url.pathname)) {
    const origin = event.request.headers.get('origin');
    const expected = trustedOrigins.size ? trustedOrigins : new Set([event.url.origin]);

    if (!origin || !expected.has(origin.replace(/\/$/, ''))) {
      console.warn(
        '[csrf] rejected form submission' +
          ` method=${event.request.method}` +
          ` path=${event.url.pathname}` +
          ` origin=${origin ?? '(none sent)'}` +
          ` url.origin=${event.url.origin}` +
          ` expected=${[...expected].join(',')}` +
          ` host=${event.request.headers.get('host') ?? '-'}` +
          ` x-forwarded-proto=${event.request.headers.get('x-forwarded-proto') ?? '-'}` +
          ` referer=${event.request.headers.get('referer') ?? '-'}`
      );
      throw error(
        403,
        origin
          ? `Form submitted from ${origin}, but this server only accepts ${[...expected].join(', ')}. ` +
              'Set ORIGIN to the URL you actually browse to.'
          : 'Your browser did not send an Origin header, which is required to submit this form. ' +
              'A privacy extension that strips Origin will cause this.'
      );
    }
  }

  event.locals.user = await validateSession(event.cookies.get(SESSION_COOKIE));

  const isPublic = PUBLIC_ROUTES.has(event.url.pathname);
  if (!event.locals.user && !isPublic) {
    throw redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`);
  }
  if (event.locals.user && event.url.pathname === '/login') {
    throw redirect(303, '/');
  }
  if (
    event.locals.user?.mustChangePassword &&
    !PASSWORD_CHANGE_ROUTES.has(event.url.pathname) &&
    !isPublic
  ) {
    throw redirect(303, '/security');
  }

  if (
    event.locals.user &&
    !event.locals.user.onboardedAt &&
    !SETUP_ROUTES.has(event.url.pathname) &&
    !event.url.pathname.startsWith(SETUP_API_PREFIX) &&
    !isPublic
  ) {
    throw redirect(303, '/welcome');
  }

  // Everything a signed-in request touches runs inside one transaction with
  // `app.user_id` set, which is what makes the row-level security policies
  // bind. Anonymous requests (/login, /health) run unscoped and therefore see
  // no tenant rows at all -- current_setting() is NULL and every policy fails
  // closed.
  // "Hide the numbers" is a cookie rather than browser storage for one reason:
  // the server has to know before it renders, or every masked session would
  // paint the real figures and blur them a frame later. The attribute goes on
  // <html> in the HTML stream itself, so the first byte is already masked.
  const hideAmounts = event.cookies.get(PRIVACY_COOKIE) === '1';
  const withPrivacy = (html: string) =>
    hideAmounts ? html.replace('<html', '<html data-hide-amounts="1"') : html;

  const render = async () =>
    resolve(event, { transformPageChunk: ({ html }) => withPrivacy(html) });

  const response = event.locals.user
    ? await runAsUser(event.locals.user.id, render)
    : await render();

  // This app renders bank balances; nothing here should ever be framed,
  // sniffed, or leaked through a referrer.
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // NOT 'no-referrer'. Per the Fetch standard, when a browser builds the Origin
  // header for a non-GET request it consults the referrer policy, and
  // 'no-referrer' serializes that origin as the literal string "null". Every
  // form POST then fails the CSRF check with Origin: null. curl ignores
  // referrer policy entirely, so this is invisible to command-line testing and
  // only shows up in a real browser.
  //
  // 'same-origin' sends a full referrer within the app and nothing at all to
  // third parties, which is the protection that was wanted, while leaving the
  // Origin header intact for same-origin submissions.
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  return response;
};

// Sentry first, so the request span covers everything `app` does -- including
// a CSRF rejection or a commit that fails. Sentry.init() is in
// instrumentation.server.ts.
export const handle = sequence(Sentry.sentryHandle(), app);

// Without this, an error thrown outside a route handler -- a transaction that
// fails to commit in `handle`, most often -- reaches the browser as a bare
// `{"message":"Internal Error"}` with nothing in the logs. The route's own
// `error(500, e.message)` is not involved by then, so the real cause is lost.
// Log it, and hand the client an id it can quote.
// Sentry captures first (when SENTRY_DSN is set), then this runs.
export const handleError: HandleServerError = Sentry.handleErrorWithSentry(({ error, event, status, message }) => {
  const id = crypto.randomUUID();
  const err = error as Error & { cause?: unknown };
  console.error(
    `[error] id=${id} status=${status} ${event.request.method} ${event.url.pathname}\n` +
      (err?.stack ?? String(error)) +
      (err?.cause ? `\ncaused by: ${(err.cause as Error)?.stack ?? String(err.cause)}` : '')
  );
  return { message: `${message} (id ${id})` };
});
