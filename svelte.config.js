import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // Replaced by an equivalent check in hooks.server.ts. SvelteKit's built-in
    // version runs before the handle hook and returns a bare 403 with no way to
    // see which origin was rejected, which makes a misconfigured deployment
    // nearly undebuggable. Ours enforces the same rule and logs the mismatch.
    csrf: { checkOrigin: false },

    // Sentry: instrumentation.server.ts runs before the app loads, and server
    // spans come from SvelteKit's own tracing.
    experimental: {
      instrumentation: { server: true },
      tracing: { server: true }
    },

    // `mode: 'auto'` lets SvelteKit hash or nonce its own injected scripts, so
    // `script-src 'self'` can stay strict without breaking hydration.
    //
    // `style-src` keeps 'unsafe-inline' because the pages use `style=` attributes
    // throughout for one-off layout; style attributes fall back to `style-src`
    // and cannot be hashed. Scripts are the injection risk that matters, and
    // those stay locked down.
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        // Plaid Link (connecting a bank) is a script and an iframe from
        // cdn.plaid.com, loaded on click by $lib/plaidLink.ts. Nothing else
        // outside this origin may run.
        'script-src': ['self', 'https://cdn.plaid.com'],
        'frame-src': ['https://cdn.plaid.com'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:'],
        'font-src': ['self'],
        'connect-src': ['self', 'https://production.plaid.com', 'https://sandbox.plaid.com'],
        'form-action': ['self'],
        'base-uri': ['self'],
        'object-src': ['none'],
        'frame-ancestors': ['none']
      }
    }
  }
};
