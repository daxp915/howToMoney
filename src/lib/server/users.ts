import { hash } from '@node-rs/argon2';
import { asc, eq, sql } from 'drizzle-orm';
import { systemDb } from './db';
import {
  accounts,
  categories,
  plaidItems,
  providerCredentials,
  sessions,
  transactions,
  users
} from './db/schema';
import { TAXONOMY } from './taxonomy';

/**
 * User provisioning.
 *
 * There is no public signup route. An admin creates every account, which means
 * a Cloudflare Access policy mistake cannot turn into a stranger holding a
 * ledger -- they would still have nothing to sign in to.
 *
 * Each user gets their own copy of the category taxonomy rather than sharing a
 * global list. Categories are user-editable, and a shared list would mean
 * renaming "Coffee" in one household changed somebody else's history.
 */

export interface UserRow {
  id: string;
  email: string;
  isAdmin: boolean;
  createdAt: Date;
  hasCredentials: boolean;
  accountCount: number;
  transactionCount: number;
  totpEnabled: boolean;
  /** Still on a password an admin chose, so they have not signed in properly yet. */
  mustChangePassword: boolean;
}

/**
 * Seeds one user's categories.
 *
 * Deliberately a system operation with an explicit user_id rather than a scoped
 * one. Provisioning runs inside an admin's request, which is already inside
 * that admin's transaction, and opening a nested scope there would leave
 * `app.user_id` pointing at the new user for the rest of the admin's request --
 * a live scope-confusion bug rather than a theoretical one.
 */
export async function seedCategoriesForUser(userId: string): Promise<number> {
  for (const [i, c] of TAXONOMY.entries()) {
    await systemDb
      .insert(categories)
      .values({ ...c, userId, isSystem: true, sortOrder: i })
      .onConflictDoNothing();
  }
  return TAXONOMY.length;
}

/** True when the address already belongs to an account. */
export async function emailExists(email: string): Promise<boolean> {
  const [row] = await systemDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);
  return !!row;
}

export async function createUser(opts: {
  email: string;
  password: string;
  isAdmin?: boolean;
  /**
   * Defaults to true: an admin typing somebody else's first password means two
   * people know it. `npm run db:seed` passes false, because there the person
   * running it is the person whose account it is.
   */
  mustChangePassword?: boolean;
  /**
   * Defaults to false, so a new account lands in the guided setup: it has no
   * bank connected, and every page would otherwise be an empty table with no
   * hint about what to do. `npm run db:seed` passes true.
   */
  onboarded?: boolean;
}): Promise<{ id: string }> {
  const email = opts.email.toLowerCase().trim();
  const passwordHash = await hash(opts.password);

  const [row] = await systemDb
    .insert(users)
    .values({
      email,
      passwordHash,
      isAdmin: opts.isAdmin ?? false,
      mustChangePassword: opts.mustChangePassword ?? true,
      onboardedAt: opts.onboarded ? new Date() : null
    })
    .returning({ id: users.id });

  await seedCategoriesForUser(row.id);

  return { id: row.id };
}

/**
 * Admin reset. Always leaves `must_change_password` set -- the admin knows the
 * password they just typed, so it is a way back in, not a password. The user's
 * own change goes through `changePassword()` in the auth module instead, which
 * checks the current password and clears the flag.
 *
 * Every session is cut. A reset is what you do when an account may be in
 * someone else's hands, and leaving their 30-day cookie alive would make the
 * reset decorative.
 */
export async function setPassword(userId: string, password: string): Promise<number> {
  await systemDb
    .update(users)
    .set({ passwordHash: await hash(password), mustChangePassword: true })
    .where(eq(users.id, userId));

  const removed = await systemDb
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });

  return removed.length;
}

/** Marks the guided setup finished, so the app stops redirecting into it. */
export async function markOnboarded(userId: string): Promise<void> {
  await systemDb.update(users).set({ onboardedAt: new Date() }).where(eq(users.id, userId));
}

export async function setAdmin(userId: string, isAdmin: boolean): Promise<void> {
  await systemDb.update(users).set({ isAdmin }).where(eq(users.id, userId));
}

/**
 * Deletes a user and, by cascade, every row they own. There is no soft delete:
 * the point of removing someone is that their financial history leaves with
 * them.
 */
export async function deleteUser(userId: string): Promise<void> {
  await systemDb.delete(users).where(eq(users.id, userId));
}

export async function listUsers(): Promise<UserRow[]> {
  // `users` carries no tenant policy, so the list itself comes through the
  // ordinary handle. The per-user counts below cannot: an admin page runs
  // inside the admin's own scope, where row-level security would report their
  // figures for everybody. Those three go through systemDb and are grouped by
  // user_id, which is the only thing that keeps each number with its owner.
  const rows = await systemDb
    .select({
      id: users.id,
      email: users.email,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
      totpConfirmedAt: users.totpConfirmedAt,
      mustChangePassword: users.mustChangePassword
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  const accountCounts = await systemDb
    .select({ userId: accounts.userId, n: sql<number>`count(*)::int` })
    .from(accounts)
    .groupBy(accounts.userId);

  const txnCounts = await systemDb
    .select({ userId: transactions.userId, n: sql<number>`count(*)::int` })
    .from(transactions)
    .groupBy(transactions.userId);

  const credentialed = [
    ...(await systemDb.select({ userId: providerCredentials.userId }).from(providerCredentials)),
    ...(await systemDb.select({ userId: plaidItems.userId }).from(plaidItems))
  ];

  const accountsBy = new Map(accountCounts.map((r) => [r.userId, r.n]));
  const txnsBy = new Map(txnCounts.map((r) => [r.userId, r.n]));
  const withCreds = new Set(credentialed.map((r) => r.userId));

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    isAdmin: r.isAdmin,
    createdAt: r.createdAt,
    hasCredentials: withCreds.has(r.id),
    accountCount: accountsBy.get(r.id) ?? 0,
    transactionCount: txnsBy.get(r.id) ?? 0,
    totpEnabled: !!r.totpConfirmedAt,
    mustChangePassword: r.mustChangePassword
  }));
}

/** Every user with a bank connection -- the set the sync worker iterates. */
export async function usersWithCredentials(): Promise<Array<{ id: string; email: string }>> {
  const rows = [
    ...(await systemDb
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .innerJoin(providerCredentials, eq(providerCredentials.userId, users.id))),
    // Plaid banks are one row each, so a household with only Plaid is here too.
    ...(await systemDb
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .innerJoin(plaidItems, eq(plaidItems.userId, users.id)))
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // SimpleFIN plus several Plaid banks is several rows for one person; dedupe
  // so nobody gets synced twice in the same pass.
  const seen = new Set<string>();
  return rows
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .map(({ id, email }) => ({ id, email }));
}
