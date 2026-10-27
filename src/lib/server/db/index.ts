import 'dotenv/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// The connection is created on first use, not at import time. SvelteKit's build
// step imports every server module to analyse it, and a build machine has no
// DATABASE_URL -- connecting eagerly breaks `npm run build` and therefore the
// Docker image.

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let instance: Db | null = null;

/**
 * The app connects as APP_DATABASE_URL when it is set -- a role that is *not*
 * the superuser, because PostgreSQL superusers bypass row-level security
 * outright and would silently turn every tenant policy into decoration.
 * DATABASE_URL stays the migration/maintenance connection.
 */
function connectionString(): string {
  const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Neither APP_DATABASE_URL nor DATABASE_URL is set');
  return url;
}

function getDb(): Db {
  if (instance) return instance;
  instance = drizzle(postgres(connectionString(), { max: 10 }), { schema });
  return instance;
}

/**
 * The transaction the current request (or worker pass) is running inside, with
 * `app.user_id` already set on it. Everything reached from within `runAsUser`
 * sees it, however deep the call stack, which is what lets the query code stay
 * unaware of tenancy.
 */
const scope = new AsyncLocalStorage<{ tx: Tx; userId: string }>();

/**
 * Runs `fn` with every query inside it scoped to one user.
 *
 * `set_local` binds the setting to this transaction, so it cannot leak to the
 * next request that borrows the same pooled connection. Row-level security
 * reads the same setting, which means the isolation is enforced by Postgres
 * rather than by remembering to write a WHERE clause.
 */
export async function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const root = getDb();
  return root.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return scope.run({ tx, userId }, fn);
  });
}

/** The user the current scope belongs to, if there is one. */
export function currentUserId(): string | null {
  return scope.getStore()?.userId ?? null;
}

/**
 * Inside `runAsUser`, this is that user's transaction; outside it, the plain
 * pool. The unscoped path is for work that has no tenant -- authentication,
 * migrations, the admin user list -- and for scripts that scope themselves.
 */
let systemInstance: Db | null = null;

/**
 * The maintenance connection: DATABASE_URL, i.e. the superuser, which
 * **bypasses row-level security**.
 *
 * It exists for the handful of questions that are legitimately about every
 * tenant at once -- how many accounts each user has, which users have a bank
 * connection for the worker to sync -- and for nothing else. Anything reachable
 * from a page render should go through `db`, so the policies still apply.
 *
 * Queries here must aggregate or filter by user_id explicitly. Returning
 * another user's rows to a page from this handle would defeat the entire
 * isolation model.
 */
export const systemDb = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    if (!systemInstance) {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL is not set (needed for maintenance queries)');
      systemInstance = drizzle(postgres(url, { max: 3 }), { schema });
    }
    const value = Reflect.get(systemInstance as object, prop, receiver);
    return typeof value === 'function' ? value.bind(systemInstance) : value;
  }
});

export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = (scope.getStore()?.tx as Db | undefined) ?? getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === 'function' ? value.bind(real) : value;
  }
});

export { schema };
