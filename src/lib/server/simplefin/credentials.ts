import { eq, sql } from 'drizzle-orm';
import { db, systemDb } from '../db';
import { providerCredentials, users } from '../db/schema';
import { decryptSecret, encryptSecret } from '../crypto';

const PROVIDER = 'simplefin';

/**
 * The SimpleFIN access URL, decrypted from the database.
 *
 * `SIMPLEFIN_ACCESS_URL` remains a valid way to configure the app: on the first
 * sync after an upgrade the env value is encrypted into the table, and from
 * then on the database is the source of truth. That import is the whole
 * migration -- nobody has to run a script, and an existing deployment keeps
 * working if the env var is left in place.
 */
export async function getSimpleFinAccessUrl(): Promise<string> {
  const [row] = await db
    .select()
    .from(providerCredentials)
    .where(eq(providerCredentials.provider, PROVIDER))
    .limit(1);

  if (row) return decryptSecret(row.secret);

  // The env URL belongs to whoever set up the server. On a single-user install
  // that is the only person who could be asking; with several users, importing
  // it here would hand the owner's bank connection to whichever account synced
  // first without one of its own (found 2026-10-14, when a Plaid-only test
  // account pulled the owner's real accounts). So it is honoured only while
  // the database holds exactly one user.
  const fromEnv = process.env.SIMPLEFIN_ACCESS_URL?.trim();
  const [{ n }] = await systemDb.select({ n: sql<number>`count(*)::int` }).from(users);
  if (fromEnv && n !== 1) {
    throw new Error(
      'No SimpleFIN connection is stored for this account. Paste a setup token under ' +
        'Settings › Connections. (The server-wide SIMPLEFIN_ACCESS_URL is only used on single-user installs.)'
    );
  }
  if (!fromEnv) {
    throw new Error(
      'No SimpleFIN credentials. Run `npm run simplefin:claim` with a setup token from ' +
        'the SimpleFIN Bridge UI.'
    );
  }

  await saveSimpleFinAccessUrl(fromEnv, "set up from the server's settings");
  return fromEnv;
}

/** Stores (or replaces) the access URL, encrypted. Never logs the value. */
export async function saveSimpleFinAccessUrl(accessUrl: string, label?: string): Promise<void> {
  const secret = encryptSecret(accessUrl);
  await db
    .insert(providerCredentials)
    .values({ provider: PROVIDER, secret, label: label ?? null })
    .onConflictDoUpdate({
      target: [providerCredentials.userId, providerCredentials.provider],
      set: { secret, label: label ?? null, updatedAt: new Date() }
    });
}

export async function hasStoredCredentials(): Promise<boolean> {
  const [row] = await db
    .select({ id: providerCredentials.id })
    .from(providerCredentials)
    .where(eq(providerCredentials.provider, PROVIDER))
    .limit(1);
  return !!row;
}
