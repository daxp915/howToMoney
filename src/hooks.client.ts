// Sentry for the browser. The DSN is read at runtime (PUBLIC_SENTRY_DSN in
// .env), so one image serves every environment and an unset value turns it off.
//
// Events go to /api/monitoring on this origin rather than to sentry.io: the
// CSP's connect-src stays 'self', and an ad blocker does not silently eat the
// errors. No session replay -- it would record screens full of balances.
import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';
import { dataCollection, scrubBreadcrumb, scrubEvent } from '$lib/sentry';

Sentry.init({
  dsn: env.PUBLIC_SENTRY_DSN,
  environment: env.PUBLIC_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
  release: __SENTRY_RELEASE__ || undefined,
  tunnel: '/api/monitoring',
  dataCollection,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0
});

export const handleError = Sentry.handleErrorWithSentry();
