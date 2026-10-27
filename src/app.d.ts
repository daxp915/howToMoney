import type { SessionUser } from '$lib/server/auth';

declare global {
  /** The deploy's git sha (vite.config.ts `define`), or null in dev. */
  const __SENTRY_RELEASE__: string | null;

  namespace App {
    interface Locals {
      user: SessionUser | null;
    }
  }
}

export {};
