import { sveltekit } from '@sveltejs/kit/vite';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';

// Source maps go to Sentry only when SENTRY_AUTH_TOKEN is present at build
// time (the NAS image build); a laptop or CI build uploads nothing.
const upload = Boolean(process.env.SENTRY_AUTH_TOKEN);
// The release every event is tagged with: the deploy's git sha (RELEASE file),
// baked into the server and browser bundles as __SENTRY_RELEASE__ (the Sentry
// plugin only injects one when it is also uploading source maps).
const release =
  process.env.SENTRY_RELEASE ||
  (existsSync('RELEASE') ? readFileSync('RELEASE', 'utf8').trim() : '') ||
  undefined;

export default defineConfig({
  plugins: [
    // Must come before sveltekit().
    sentrySvelteKit({
      adapter: 'node',
      autoUploadSourceMaps: upload,
      org: process.env.SENTRY_ORG ?? 'htmfd',
      project: process.env.SENTRY_PROJECT ?? 'biscuit',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: release },
      telemetry: false
    }),
    sveltekit()
  ],
  // The Sentry plugin pulls the Anthropic SDK into the server bundle so it can
  // record model calls, and Rollup then mis-chunks the SDK's node shims
  // ("cp is not defined" at build). We want no AI recording anyway -- Advisor
  // inputs are a household's figures -- so keep it external. The plugin's
  // "marked as external" warning at build is expected.
  ssr: { external: ['@anthropic-ai/sdk'] },
  define: { __SENTRY_RELEASE__: JSON.stringify(release ?? null) },
  server: { host: '0.0.0.0', port: 5173 }
});
