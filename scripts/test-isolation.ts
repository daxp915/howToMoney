// Proves tenant isolation against a real database.
//
//   SMOKE_TEST_DATABASE_URL=…/howtomoney_test npm run test:isolation
//
// This is the test that matters most in a multi-user build: every other bug
// shows up as a wrong number, but a missing scope shows somebody else their
// father's bank balance. It creates two users, gives each an account and a
// transaction, and then tries, from inside each user's scope, to read, update
// and delete the other's rows.
//
// It refuses DATABASE_URL for the same reason the smoke test does -- it writes
// and deletes -- and requires a separately named database.
import 'dotenv/config';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';

const testUrl = process.env.SMOKE_TEST_DATABASE_URL;
if (!testUrl) {
  console.error(
    'Set SMOKE_TEST_DATABASE_URL to a database you are happy to have truncated,\n' +
      'and NOT the one in DATABASE_URL.'
  );
  process.exit(1);
}
if (process.env.DATABASE_URL && testUrl === process.env.DATABASE_URL) {
  console.error('SMOKE_TEST_DATABASE_URL must not equal DATABASE_URL.');
  process.exit(1);
}

// The app modules read these at import time, so they are set before the imports
// below resolve.
process.env.DATABASE_URL = testUrl;
delete process.env.APP_DATABASE_URL;

const {
  accountBalances,
  accounts,
  advisorConversations,
  advisorTurns,
  holdingSnapshots,
  plaidItems,
  syncJobs,
  transactions,
  userPreferences,
  users
} = await import('../src/lib/server/db/schema');
const { runAsUser, systemDb } = await import('../src/lib/server/db');

let failures = 0;
function check(name: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!pass) failures++;
}

const admin = postgres(testUrl, { max: 1 });

/**
 * Removing a role means removing every grant that references it first --
 * database-level CONNECT included, which `DROP OWNED BY` does not cover.
 * Otherwise the next run fails on "privileges for database" and the real
 * results are buried under a stack trace.
 */
async function dropTestRole(database: string) {
  const [{ exists }] = await admin`
    select exists(select 1 from pg_roles where rolname = 'howtomoney_iso_test') as exists
  `;
  if (!exists) return;
  await admin.unsafe(`REVOKE ALL PRIVILEGES ON DATABASE "${database}" FROM howtomoney_iso_test`);
  await admin.unsafe('DROP OWNED BY howtomoney_iso_test');
  await admin.unsafe('DROP ROLE howtomoney_iso_test');
}

async function main() {
  // Rebuild from nothing: this exercises the migrations themselves, and leaves
  // no chance of stale rows from an earlier run colouring the result.
  // The migration bookkeeping lives in its own schema; dropping only `public`
  // would leave Drizzle believing every migration had already run and skipping
  // straight to the newest one.
  await admin.unsafe(
    'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public'
  );
  await migrate(drizzle(admin), { migrationsFolder: './drizzle' });

  // A role that row-level security actually applies to.
  const password = crypto.randomBytes(16).toString('base64url');
  const database = new URL(testUrl).pathname.replace(/^\//, '');
  await dropTestRole(database);
  await admin.unsafe(`CREATE ROLE howtomoney_iso_test LOGIN PASSWORD '${password}'`);
  await admin.unsafe(`GRANT CONNECT ON DATABASE "${database}" TO howtomoney_iso_test`);
  await admin.unsafe('GRANT USAGE ON SCHEMA public TO howtomoney_iso_test');
  await admin.unsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO howtomoney_iso_test'
  );

  const appUrl = new URL(testUrl);
  appUrl.username = 'howtomoney_iso_test';
  appUrl.password = password;
  process.env.APP_DATABASE_URL = appUrl.toString();

  // Two users, each with one account and one transaction, created as superuser
  // so the fixtures do not depend on the thing being tested.
  const [alice] = await systemDb
    .insert(users)
    .values({ email: 'alice@example.com', passwordHash: 'x', isAdmin: true })
    .returning({ id: users.id });
  const [bob] = await systemDb
    .insert(users)
    .values({ email: 'bob@example.com', passwordHash: 'x' })
    .returning({ id: users.id });

  async function fixture(userId: string, tag: string) {
    const [account] = await systemDb
      .insert(accounts)
      .values({ userId, providerAccountId: `acct-${tag}`, name: `${tag} checking` })
      .returning({ id: accounts.id });
    const [txn] = await systemDb
      .insert(transactions)
      .values({
        userId,
        accountId: account.id,
        providerTxnId: `txn-${tag}`,
        postedAt: new Date(),
        amount: '-12.34',
        description: `${tag} coffee`,
        normalizedKey: `${tag}-coffee`
      })
      .returning({ id: transactions.id });
    return { accountId: account.id, txnId: txn.id };
  }

  const aliceRows = await fixture(alice.id, 'alice');
  const bobRows = await fixture(bob.id, 'bob');

  // ---- reads -------------------------------------------------------------
  const aliceSees = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db.select({ id: transactions.id }).from(transactions);
  });
  check('a user sees only their own transactions', aliceSees.length === 1, `saw ${aliceSees.length}`);
  check("...and it is their own row", aliceSees[0]?.id === aliceRows.txnId);

  const aliceAccounts = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db.select({ id: accounts.id }).from(accounts);
  });
  check('a user sees only their own accounts', aliceAccounts.length === 1);

  // ---- targeted read of someone else's row -------------------------------
  const stolen = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db.select().from(transactions).where(eq(transactions.id, bobRows.txnId));
  });
  check("asking for another user's row by id returns nothing", stolen.length === 0);

  // ---- writes ------------------------------------------------------------
  const updated = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db
      .update(transactions)
      .set({ description: 'hijacked' })
      .where(eq(transactions.id, bobRows.txnId))
      .returning({ id: transactions.id });
  });
  check("updating another user's row changes nothing", updated.length === 0);

  const deleted = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db
      .delete(transactions)
      .where(eq(transactions.id, bobRows.txnId))
      .returning({ id: transactions.id });
  });
  check("deleting another user's row deletes nothing", deleted.length === 0);

  const bobIntact = await systemDb
    .select({ description: transactions.description })
    .from(transactions)
    .where(eq(transactions.id, bobRows.txnId));
  check("the other user's row survived untouched", bobIntact[0]?.description === 'bob coffee');

  // ---- inserting on behalf of someone else -------------------------------
  let forgedBlocked = false;
  try {
    await runAsUser(alice.id, async () => {
      const { db } = await import('../src/lib/server/db');
      await db.insert(accounts).values({
        userId: bob.id,
        providerAccountId: 'forged',
        name: 'forged account'
      });
    });
  } catch {
    forgedBlocked = true;
  }
  check("inserting a row owned by another user is refused", forgedBlocked);

  // ---- tables added after the multi-user migration -----------------------
  // A new tenant table with no policy is the quiet way this whole model fails:
  // nothing errors, every household just reads every other. Each one added
  // since gets the same four questions as `accounts` did.
  await systemDb
    .insert(accountBalances)
    .values({ userId: alice.id, accountId: aliceRows.accountId, asOf: '2026-01-01', balance: '100.00' });
  await systemDb
    .insert(accountBalances)
    .values({ userId: bob.id, accountId: bobRows.accountId, asOf: '2026-01-01', balance: '250.00' });

  const aliceBalances = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db.select({ balance: accountBalances.balance }).from(accountBalances);
  });
  check(
    'balance snapshots are scoped to their owner',
    aliceBalances.length === 1 && aliceBalances[0]?.balance === '100.00',
    `saw ${aliceBalances.length}`
  );

  const holding = (userId: string, accountId: string, marketValue: string) => ({
    userId,
    accountId,
    asOf: '2026-01-01',
    holdingKey: 'FZROX',
    symbol: 'FZROX',
    shares: '10',
    marketValue
  });
  await systemDb.insert(holdingSnapshots).values(holding(alice.id, aliceRows.accountId, '300.00'));
  await systemDb.insert(holdingSnapshots).values(holding(bob.id, bobRows.accountId, '900.00'));

  const aliceHoldings = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db.select({ marketValue: holdingSnapshots.marketValue }).from(holdingSnapshots);
  });
  check(
    'holding snapshots are scoped to their owner',
    aliceHoldings.length === 1 && aliceHoldings[0]?.marketValue === '300.00',
    `saw ${aliceHoldings.length}`
  );

  const wipedHoldings = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db.delete(holdingSnapshots).returning({ id: holdingSnapshots.id });
  });
  const bobStillHolds = await systemDb
    .select({ id: holdingSnapshots.id })
    .from(holdingSnapshots)
    .where(eq(holdingSnapshots.userId, bob.id));
  check(
    "one user cannot delete another's holdings",
    wipedHoldings.length === 1 && bobStillHolds.length === 1,
    `deleted ${wipedHoldings.length}, bob has ${bobStillHolds.length}`
  );

  let forgedHolding = false;
  try {
    await runAsUser(alice.id, async () => {
      const { db } = await import('../src/lib/server/db');
      await db.insert(holdingSnapshots).values(holding(bob.id, bobRows.accountId, '1.00'));
    });
  } catch {
    forgedHolding = true;
  }
  check('a holding snapshot cannot be forged for another user', forgedHolding);

  await systemDb
    .insert(userPreferences)
    .values({ userId: alice.id, hiddenTabs: ['/budgets'] });
  await systemDb.insert(userPreferences).values({ userId: bob.id, hiddenTabs: ['/goals'] });

  const bobPrefs = await runAsUser(bob.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db.select({ hiddenTabs: userPreferences.hiddenTabs }).from(userPreferences);
  });
  check(
    'display preferences are scoped to their owner',
    bobPrefs.length === 1 && bobPrefs[0]?.hiddenTabs?.[0] === '/goals',
    JSON.stringify(bobPrefs)
  );

  // Plaid items hold (encrypted) bank access tokens: the worst table to leak.
  const item = (userId: string, itemId: string) => ({ userId, itemId, accessToken: 'v1.not.a.real.token' });
  await systemDb.insert(plaidItems).values(item(alice.id, 'item-alice'));
  await systemDb.insert(plaidItems).values(item(bob.id, 'item-bob'));

  const aliceItems = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db.select({ itemId: plaidItems.itemId }).from(plaidItems);
  });
  check(
    'Plaid items are scoped to their owner',
    aliceItems.length === 1 && aliceItems[0]?.itemId === 'item-alice',
    JSON.stringify(aliceItems)
  );

  const wipedItems = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db.delete(plaidItems).returning({ id: plaidItems.id });
  });
  const bobStillLinked = await systemDb
    .select({ id: plaidItems.id })
    .from(plaidItems)
    .where(eq(plaidItems.userId, bob.id));
  check(
    "one user cannot delete another's Plaid items",
    wipedItems.length === 1 && bobStillLinked.length === 1,
    `deleted ${wipedItems.length}, bob has ${bobStillLinked.length}`
  );

  let forgedItem = false;
  try {
    await runAsUser(alice.id, async () => {
      const { db } = await import('../src/lib/server/db');
      await db.insert(plaidItems).values(item(bob.id, 'item-forged'));
    });
  } catch {
    forgedItem = true;
  }
  check("inserting a Plaid item owned by another user is refused", forgedItem);

  // Sync jobs: one open job per person, across processes -- and one person's
  // running sync must neither show to, nor block, anybody else's.
  const { claimSync, syncStatus } = await import('../src/lib/server/syncJob');
  const aliceJob = await claimSync(alice.id, 'manual');
  const aliceAgain = await claimSync(alice.id, 'schedule');
  const bobJob = await claimSync(bob.id, 'manual');
  check('a second sync for the same person is refused', !!aliceJob && aliceAgain === null);
  check("...but another person's sync is not", !!bobJob && bobJob !== aliceJob);
  const bobSees = await runAsUser(bob.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db.select({ id: syncJobs.id }).from(syncJobs);
  });
  check('sync jobs are scoped to their owner', bobSees.length === 1 && bobSees[0]?.id === bobJob, JSON.stringify(bobSees));
  await systemDb
    .update(syncJobs)
    .set({ finishedAt: new Date(), error: 'no credentials' })
    .where(eq(syncJobs.userId, bob.id));
  const bobStatus = await runAsUser(bob.id, () => syncStatus());
  const bobStatusAgain = await runAsUser(bob.id, () => syncStatus());
  const aliceStatus = await runAsUser(alice.id, () => syncStatus());
  check('a failed job is reported once', bobStatus.failure === 'no credentials' && bobStatusAgain.failure === null);
  check("...and only to its owner, who still sees their own running", aliceStatus.running && aliceStatus.failure === null);
  let forgedJob = false;
  try {
    await runAsUser(alice.id, async () => {
      const { db } = await import('../src/lib/server/db');
      await db.insert(syncJobs).values({ userId: bob.id, origin: 'manual' });
    });
  } catch {
    forgedJob = true;
  }
  check('inserting a sync job owned by another user is refused', forgedJob);

  // A job whose runner died (stale heartbeat) is taken over and run again --
  // here the run fails at once (Alice has no bank), which closes it -- and a
  // job that has already killed three runners is given up on, not retried.
  const { resumeOrphanedSyncs } = await import('../src/lib/server/syncJob');
  await systemDb
    .update(syncJobs)
    .set({ heartbeatAt: new Date(Date.now() - 5 * 60_000) })
    .where(eq(syncJobs.id, aliceJob!));
  const resumed = await resumeOrphanedSyncs(() => {});
  const [aliceAfter] = await systemDb.select().from(syncJobs).where(eq(syncJobs.id, aliceJob!));
  check('an orphaned sync is taken over', resumed === 1 && aliceAfter.attempts === 2 && !!aliceAfter.finishedAt, JSON.stringify({ resumed, attempts: aliceAfter.attempts, error: aliceAfter.error }));
  const doomed = await claimSync(alice.id, 'manual');
  await systemDb
    .update(syncJobs)
    .set({ heartbeatAt: new Date(Date.now() - 5 * 60_000), attempts: 3 })
    .where(eq(syncJobs.id, doomed!));
  const resumedDoomed = await resumeOrphanedSyncs(() => {});
  const [doomedAfter] = await systemDb.select().from(syncJobs).where(eq(syncJobs.id, doomed!));
  check('...but not a fourth time', resumedDoomed === 0 && !!doomedAfter.finishedAt && !!doomedAfter.error);

  const stolenPrefs = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db
      .update(userPreferences)
      .set({ hiddenTabs: ['/everything'] })
      .where(eq(userPreferences.userId, bob.id))
      .returning({ id: userPreferences.id });
  });
  check("one user cannot rewrite another's preferences", stolenPrefs.length === 0);

  // ---- advisor conversations -----------------------------------------------
  // Questions about somebody's money are as private as the money.
  const conversation = async (userId: string, question: string) => {
    const [c] = await systemDb.insert(advisorConversations).values({ userId, title: question }).returning();
    await systemDb.insert(advisorTurns).values({ userId, conversationId: c.id, question, status: 'done' });
    return c.id;
  };
  await conversation(alice.id, 'Can I afford a TV?');
  const bobConversation = await conversation(bob.id, 'When is the car paid off?');

  const aliceAsks = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return {
      conversations: await db.select({ title: advisorConversations.title }).from(advisorConversations),
      turns: await db.select({ question: advisorTurns.question }).from(advisorTurns)
    };
  });
  check(
    'advisor conversations are scoped to their owner',
    aliceAsks.conversations.length === 1 && aliceAsks.conversations[0]?.title === 'Can I afford a TV?',
    JSON.stringify(aliceAsks.conversations)
  );
  check(
    'advisor questions are scoped to their owner',
    aliceAsks.turns.length === 1 && aliceAsks.turns[0]?.question === 'Can I afford a TV?',
    JSON.stringify(aliceAsks.turns)
  );

  const erased = await runAsUser(alice.id, async () => {
    const { db } = await import('../src/lib/server/db');
    return db
      .delete(advisorConversations)
      .where(eq(advisorConversations.id, bobConversation))
      .returning({ id: advisorConversations.id });
  });
  check("one user cannot delete another's conversation", erased.length === 0);

  let forgedTurn = false;
  try {
    await runAsUser(alice.id, async () => {
      const { db } = await import('../src/lib/server/db');
      await db
        .insert(advisorTurns)
        .values({ userId: bob.id, conversationId: bobConversation, question: 'planted' });
    });
  } catch {
    forgedTurn = true;
  }
  check("a question cannot be planted in another user's conversation", forgedTurn);

  // ---- no scope at all ---------------------------------------------------
  const { db } = await import('../src/lib/server/db');
  const unscoped = await db.select({ id: transactions.id }).from(transactions);
  check('an unscoped query sees nothing at all', unscoped.length === 0, `saw ${unscoped.length}`);

  // ---- the tenant column defaults from the scope -------------------------
  const defaulted = await runAsUser(bob.id, async () => {
    const { db } = await import('../src/lib/server/db');
    const [row] = await db
      .insert(accounts)
      .values({ providerAccountId: 'defaulted', name: 'no user_id given' })
      .returning({ id: accounts.id, userId: accounts.userId });
    return row;
  });
  check('an insert with no user_id inherits the current scope', defaulted.userId === bob.id);

  await dropTestRole(database);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
}

main()
  .then(async () => {
    await admin.end();
    process.exit(failures ? 1 : 0);
  })
  .catch(async (e) => {
    console.error(e);
    await admin.end();
    process.exit(1);
  });
