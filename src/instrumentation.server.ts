// Sentry for the web server. Runs once at startup, before any route module
// (svelte.config.js: kit.experimental.instrumentation.server). No SENTRY_DSN
// means the SDK stays off -- local dev and CI send nothing unless asked to.
import * as Sentry from '@sentry/sveltekit';
import { dataCollection, scrubBreadcrumb, scrubEvent } from './lib/sentry';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  release: process.env.SENTRY_RELEASE || __SENTRY_RELEASE__ || undefined,
  dataCollection,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0
});
