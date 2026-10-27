import 'dotenv/config';
import { runSync } from '../src/lib/server/sync/sync';
import { usersWithCredentials } from '../src/lib/server/users';

// Initial backfill:  npm run sync:once -- 730
// Routine sync:      npm run sync:once
const days = process.argv[2] ? Number(process.argv[2]) : 90;

// Syncs every user who has a bank connection, or one named by email:
//   npm run sync:once -- 30 dad@example.com
const onlyEmail = process.argv[3]?.toLowerCase();

async function main() {
  const users = (await usersWithCredentials()).filter(
    (u) => !onlyEmail || u.email.toLowerCase() === onlyEmail
  );

  if (!users.length) {
    console.error(
      onlyEmail
        ? `No user ${onlyEmail} with a bank connection.`
        : 'Nobody has a bank connection yet. Connect one under /connect.'
    );
    process.exit(1);
  }

  for (const user of users) {
    const summary = await runSync({ userId: user.id, days });
    console.log(user.email, JSON.stringify(summary, null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('sync failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
