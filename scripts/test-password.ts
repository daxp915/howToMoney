// Proves the password-change path against a real database.
//
//   SMOKE_TEST_DATABASE_URL=…/howtomoney_test npm run test:password
//
// The interesting cases are the ones that fail quietly if they regress: a
// change that leaves the forced-change flag set, a reset that leaves the old
// session cookie alive, or a "new" password that is the temporary one typed
// twice. None of those raise; they just leave an account less protected than
// the UI claims.
//
// It refuses DATABASE_URL and requires a separately named database, for the
// same reason the smoke and isolation tests do -- it drops and rebuilds the
// schema.
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';

const testUrl = process.env.SMOKE_TEST_DATABASE_URL;
if (!testUrl) {
  console.error(
    'Set SMOKE_TEST_DATABASE_URL to a database you are happy to have rebuilt,\n' +
      'and NOT the one in DATABASE_URL.'
  );
  process.exit(1);
}
if (process.env.DATABASE_URL && testUrl === process.env.DATABASE_URL) {
  console.error('SMOKE_TEST_DATABASE_URL must not equal DATABASE_URL.');
  process.exit(1);
}

// The app modules read these at import time, so they are set before the imports
// below resolve. No restricted role here: `users` and `sessions` carry no
// tenant policy, so this test is about the auth logic, not about scoping --
// that is `npm run test:isolation`.
process.env.DATABASE_URL = testUrl;
delete process.env.APP_DATABASE_URL;

const { sessions, users } = await import('../src/lib/server/db/schema');
const { systemDb } = await import('../src/lib/server/db');
const { changePassword, createSession, login, purgeExpiredSessions } = await import(
  '../src/lib/server/auth'
);
const { createUser, listUsers, setPassword } = await import('../src/lib/server/users');
const { checkThrottle, recordFailure, recordSuccess } = await import('../src/lib/server/auth/throttle');

let failures = 0;
function check(name: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!pass) failures++;
}

const admin = postgres(testUrl, { max: 1 });

const TEMP = 'temporary-password-1';
const CHOSEN = 'a-much-longer-passphrase';

async function flagOf(userId: string): Promise<boolean> {
  const [row] = await systemDb
    .select({ flag: users.mustChangePassword })
    .from(users)
    .where(eq(users.id, userId));
  return row.flag;
}

async function sessionIds(userId: string): Promise<string[]> {
  const rows = await systemDb
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  return rows.map((r) => r.id);
}

async function main() {
  // The migration bookkeeping lives in its own schema; dropping only `public`
  // would leave Drizzle believing every migration had already run.
  await admin.unsafe(
    'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public'
  );
  await migrate(drizzle(admin), { migrationsFolder: './drizzle' });

  // ---- how an account starts ---------------------------------------------
  const { id } = await createUser({ email: 'dad@example.com', password: TEMP });
  check('an admin-created account starts on a forced change', await flagOf(id));

  const { id: seeded } = await createUser({
    email: 'self@example.com',
    password: TEMP,
    mustChangePassword: false
  });
  check('a self-chosen password (db:seed) does not force one', !(await flagOf(seeded)));

  // Three sessions: the one doing the changing, and two to be cut.
  const keep = await createSession(id);
  const other = await createSession(id);
  await createSession(id);
  check('fixture has three sessions', (await sessionIds(id)).length === 3);

  // ---- rejections ---------------------------------------------------------
  const wrong = await changePassword(id, 'not-the-password', CHOSEN, keep.id);
  check('a wrong current password is refused', !wrong.ok && wrong.reason === 'bad_current');
  check('...and the forced-change flag survives it', await flagOf(id));
  check('...and no session was cut', (await sessionIds(id)).length === 3);

  const short = await changePassword(id, TEMP, 'short', keep.id);
  check('a too-short new password is refused', !short.ok && short.reason === 'too_short');

  const same = await changePassword(id, TEMP, TEMP, keep.id);
  check('re-typing the temporary password is refused', !same.ok && same.reason === 'unchanged');
  check('...so the flag cannot be cleared without changing anything', await flagOf(id));

  // ---- the change itself --------------------------------------------------
  const ok = await changePassword(id, TEMP, CHOSEN, keep.id);
  check('a valid change succeeds', ok.ok);
  check('...and clears the forced-change flag', !(await flagOf(id)));
  check('...and reports the sessions it ended', ok.otherSessionsEnded === 2, `${ok.otherSessionsEnded}`);

  const left = await sessionIds(id);
  check('only the changing session survives', left.length === 1 && left[0] === keep.id);
  check('the other session is gone', !left.includes(other.id));

  const [row] = await systemDb
    .select({ changedAt: users.passwordChangedAt })
    .from(users)
    .where(eq(users.id, id));
  check('the change is stamped', !!row.changedAt);

  const withNew = await login('dad@example.com', CHOSEN);
  check('the new password signs in', withNew.ok);
  const withOld = await login('dad@example.com', TEMP);
  check('the old password does not', !withOld.ok);

  // ---- admin reset --------------------------------------------------------
  await createSession(id);
  const signedOut = await setPassword(id, 'admin-typed-this-one');
  check('an admin reset forces a change again', await flagOf(id));
  check('...and cuts every session', (await sessionIds(id)).length === 0, `cut ${signedOut}`);

  const listed = (await listUsers()).find((u) => u.id === id);
  check('the admin list shows the temporary password', listed?.mustChangePassword === true);

  // ---- expired sessions ----------------------------------------------------
  // One live session and one that expired a minute ago: the cleanup takes the
  // expired one, for any user, and leaves the live one alone.
  const live = await createSession(id);
  await systemDb
    .insert(sessions)
    .values({ id: `expired-${Date.now()}`, userId: id, expiresAt: new Date(Date.now() - 60_000) });
  const purged = await purgeExpiredSessions();
  const remaining = await sessionIds(id);
  check('the cleanup removes expired sessions', purged >= 1 && !remaining.some((s) => s.startsWith('expired-')), `purged ${purged}`);
  check('...and leaves live ones alone', remaining.includes(live.id));

  // ---- login throttle ------------------------------------------------------
  // In the database so a second container shares the count; the same
  // arithmetic the in-memory version ran, against the table.
  const t0 = new Date('2026-01-01T00:00:00Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);
  for (let i = 0; i < 5; i++) await recordFailure('Guess@Example.com', '10.0.0.1', at(i));
  check('five failures are free', !(await checkThrottle('guess@example.com', '10.0.0.9', at(10))).blocked);
  await recordFailure('guess@example.com', '10.0.0.1', at(20));
  const sixth = await checkThrottle('guess@example.com', '10.0.0.9', at(30));
  check('the sixth blocks the address, from any IP', sixth.blocked && sixth.retryAfterSeconds === 30, `${sixth.retryAfterSeconds}s`);
  const byIp = await checkThrottle('someone-else@example.com', '10.0.0.1', at(30));
  check('...and the IP, for any address', byIp.blocked);
  await recordFailure('guess@example.com', '10.0.0.2', at(31_000));
  const seventh = await checkThrottle('guess@example.com', '10.0.0.9', at(31_000));
  check('the delay doubles', seventh.retryAfterSeconds === 60, `${seventh.retryAfterSeconds}s`);
  check('it clears after the delay', !(await checkThrottle('guess@example.com', '10.0.0.9', at(92_000))).blocked);
  // An hour of quiet: the next failure starts again at one, not eight.
  await recordFailure('guess@example.com', '10.0.0.3', at(2 * 60 * 60_000));
  check('an hour of quiet forgets the record', !(await checkThrottle('guess@example.com', '10.0.0.9', at(2 * 60 * 60_000 + 1))).blocked);
  for (let i = 0; i < 6; i++) await recordFailure('ok@example.com', '10.0.0.4', at(3 * 60 * 60_000 + i));
  await recordSuccess('ok@example.com', '10.0.0.4');
  check('a success clears both keys', !(await checkThrottle('ok@example.com', '10.0.0.4', at(3 * 60 * 60_000 + 10))).blocked);

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
