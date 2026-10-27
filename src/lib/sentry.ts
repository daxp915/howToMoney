// What every Sentry.init() in this app shares: the web server, the browser and
// the worker. This is a money app, so the defaults are inverted -- nothing about
// a person, a request body, a query parameter or a bound SQL value leaves the
// box, and figures that slip into an error message are masked before sending.
//
// Imports nothing outside this file: the worker loads it under tsx, where
// SvelteKit's $lib aliases do not resolve.
import type { ErrorEvent, EventHint, Breadcrumb, BrowserOptions } from '@sentry/sveltekit';

export const dataCollection: NonNullable<BrowserOptions['dataCollection']> = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ['user-agent', 'content-type'] }, response: false },
  httpBodies: [],
  // Drill-down links carry merchant names and categories (?merchant=, ?category=).
  urlQueryParams: false,
  // Bound parameters are amounts, descriptors and user ids. The parameterized
  // statement text (`... where user_id = $1`) is still collected.
  databaseQueryData: false,
  // The Advisor sends a household's aggregates to the model; never mirror them.
  genAI: { inputs: false, outputs: false },
  queues: false,
  stackFrameVariables: false
};

// "$1,234.56", "-$57", "$ 12" -> "$•••". Emails -> "•••@•••".
const MONEY = /-?\$\s?-?\d[\d,]*(?:\.\d+)?/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export function scrubText(text: string): string;
export function scrubText(text: string | undefined): string | undefined;
export function scrubText(text: string | undefined): string | undefined {
  return text?.replace(MONEY, '$•••').replace(EMAIL, '•••@•••');
}

function stripQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}

export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  delete event.user;
  if (event.request) {
    event.request.url = stripQuery(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
  }
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) ex.value = scrubText(ex.value);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean) as Breadcrumb[];
  return event;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // Console lines are the app's own logs, which print descriptors and ids.
  if (crumb.category === 'console') return null;
  if (crumb.message) crumb.message = scrubText(crumb.message);
  const data = crumb.data as Record<string, unknown> | undefined;
  if (data) {
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = stripQuery(data[key] as string);
    }
  }
  return crumb;
}
