import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import { createUser, seedCategoriesForUser } from '../src/lib/server/users';
import { TAXONOMY } from '../src/lib/server/taxonomy';


async function main() {
  const email = process.env.SEED_EMAIL;
  const password = process.env.SEED_PASSWORD;

  if (!email || !password) {
    console.log('set SEED_EMAIL and SEED_PASSWORD to create the first user');
    process.exit(0);
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()));

  if (existing) {
    // Categories belong to a user now, so re-seeding fills in any the taxonomy
    // has gained since this account was created. Nothing existing is touched.
    const added = await seedCategoriesForUser(existing.id);
    console.log(`user ${email} already exists; ensured ${added} categories`);
    process.exit(0);
  }

  // The first user is the admin: somebody has to be able to create the others,
  // and there is no public signup.
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  // No forced change here: whoever runs the seed chose SEED_PASSWORD themselves,
  // so it is not a password two people know.
  const { id } = await createUser({
    email,
    password,
    isAdmin: count === 0,
    mustChangePassword: false,
    // Whoever runs the seed is setting the box up by hand; the guided flow is
    // for people arriving through an invite.
    onboarded: true
  });

  console.log(
    `seeded user ${email}${count === 0 ? ' (admin)' : ''} with ${TAXONOMY.length} categories (id ${id})`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
