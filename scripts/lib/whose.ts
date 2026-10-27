import { asc, eq } from 'drizzle-orm';
import { systemDb } from '../../src/lib/server/db';
import { users } from '../../src/lib/server/db/schema';

/**
 * Works out which user a maintenance script should run as.
 *
 * Every table is behind row-level security now, so a script with no scope sees
 * an empty database and reports cheerfully that it changed nothing. Rather than
 * let that happen quietly, resolve a user up front and fail loudly when the
 * answer is ambiguous.
 *
 * With one user, that user is the answer. With several, the script has to be
 * told which, by email.
 */
export async function resolveUserArg(emailArg?: string): Promise<{ id: string; email: string }> {
  const all = await systemDb
    .select({ id: users.id, email: users.email })
    .from(users)
    .orderBy(asc(users.createdAt));

  if (!all.length) throw new Error('No users exist yet. Run `npm run db:seed` first.');

  const wanted = emailArg?.trim().toLowerCase();
  if (wanted) {
    const [match] = await systemDb
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, wanted))
      .limit(1);
    if (!match) throw new Error(`No user with email ${wanted}.`);
    return match;
  }

  if (all.length === 1) return all[0];

  throw new Error(
    `This database has ${all.length} users (${all.map((u) => u.email).join(', ')}). ` +
      'Pass the email of the one to act on, e.g. `npm run recurring -- dad@example.com`.'
  );
}
