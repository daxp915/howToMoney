import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, lt, ne, sql } from 'drizzle-orm';
import { TOTP } from 'otpauth';
import { db } from '../db';
import { sessions, userActiveDays, users } from '../db/schema';

// Application auth is the inner layer. Cloudflare Access sits in front and is
// the primary gate -- unauthenticated traffic should never reach this process.
// This exists so the app is not naked if the tunnel config ever regresses.

const TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);
export const SESSION_COOKIE = 'htm_session';

/**
 * Shared by the admin form, the change form, the registration form and anything
 * else that sets a password. Defined in `$lib/passwords` so the browser can
 * state the rule without importing any of this module.
 */
// A relative path, not `$lib`: the maintenance scripts import this module
// through tsx, which has none of SvelteKit's aliases.
import { MIN_PASSWORD } from '../../passwords';
export { MIN_PASSWORD };

export interface SessionUser {
  id: string;
  email: string;
  totpEnabled: boolean;
  /** Admins can create and remove other users. Nobody else sees those routes. */
  isAdmin: boolean;
  /** True while the account still holds a password an admin chose. */
  mustChangePassword: boolean;
  /** Null until the guided setup has been finished. */
  onboardedAt: Date | null;
}

function newSessionId(): string {
  return crypto.randomBytes(32).toString('base64url');
}

const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

/** How often a live session's `last_seen_at` is rewritten: not every request. */
const SEEN_EVERY_MS = 5 * 60 * 1000;

export async function createSession(
  userId: string,
  userAgent?: string | null
): Promise<{ id: string; expiresAt: Date }> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt,
    userAgent: userAgent?.slice(0, 400) || null,
    lastSeenAt: new Date()
  });
  // Signing in is a day used. validateSession() records later days, but only
  // once lastSeenAt goes stale -- which a fresh session's is not.
  await recordActiveDay(userId);
  return { id, expiresAt };
}

async function recordActiveDay(userId: string) {
  await db
    .insert(userActiveDays)
    .values({ userId, day: sql`current_date` as unknown as string })
    .onConflictDoNothing();
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  signedInAt: Date;
  lastSeenAt: Date;
}

/**
 * One user's live sessions, most recently active first. Expired rows are left
 * out -- they are dead cookies, not places somebody is signed in.
 */
export async function listSessions(userId: string): Promise<SessionInfo[]> {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
  return rows
    .map((r) => {
      // The expiry is fixed when the session is made, so it says when that was.
      const signedInAt = new Date(r.expiresAt.getTime() - TTL_MS);
      return { id: r.id, userAgent: r.userAgent, signedInAt, lastSeenAt: r.lastSeenAt ?? signedInAt };
    })
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

export async function validateSession(sessionId: string | undefined): Promise<SessionUser | null> {
  if (!sessionId) return null;

  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      totpConfirmedAt: users.totpConfirmedAt,
      isAdmin: users.isAdmin,
      mustChangePassword: users.mustChangePassword,
      onboardedAt: users.onboardedAt,
      lastSeenAt: sessions.lastSeenAt
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId));

  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  // "Last active" on the Security page. Coarse on purpose: one write every few
  // minutes per session, not one per request.
  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > SEEN_EVERY_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
    // The beta's weekly-actives record: one row per person per day, so at
    // most one insert per session every few minutes, almost all no-ops.
    await recordActiveDay(row.id);
  }

  return {
    id: row.id,
    email: row.email,
    totpEnabled: !!row.totpConfirmedAt,
    isAdmin: row.isAdmin,
    mustChangePassword: row.mustChangePassword,
    onboardedAt: row.onboardedAt
  };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Deletes every session past its expiry, for every user, and says how many.
 *
 * An expired session is otherwise only removed when somebody presents its
 * cookie again, so the table kept every sign-in ever made. Nothing showed them
 * -- the Security page counts live sessions only -- but a row per sign-in, kept
 * forever, is a record nobody asked for. `sessions` carries no row-level
 * security, so this reaches every user's rows from any connection.
 */
export async function purgeExpiredSessions(now = new Date()): Promise<number> {
  const gone = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  return gone.length;
}

export interface LoginResult {
  ok: boolean;
  userId?: string;
  reason?: 'bad_credentials' | 'bad_totp';
}

export async function login(
  email: string,
  password: string,
  totpCode?: string
): Promise<LoginResult> {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));

  // Run the hash comparison even when the user is missing so a failed lookup
  // and a wrong password take the same amount of time.
  const hashToCheck =
    user?.passwordHash ??
    '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000';

  let passwordOk = false;
  try {
    passwordOk = await verify(hashToCheck, password);
  } catch {
    passwordOk = false;
  }
  if (!user || !passwordOk) return { ok: false, reason: 'bad_credentials' };

  if (user.totpSecret && user.totpConfirmedAt) {
    if (!totpCode) return { ok: false, reason: 'bad_totp' };
    const totp = new TOTP({ secret: user.totpSecret, digits: 6, period: 30 });
    // window: 1 tolerates one step of clock drift in either direction.
    if (totp.validate({ token: totpCode.replace(/\s/g, ''), window: 1 }) === null) {
      return { ok: false, reason: 'bad_totp' };
    }
  }

  return { ok: true, userId: user.id };
}

export interface PasswordChangeResult {
  ok: boolean;
  reason?: 'bad_current' | 'too_short' | 'unchanged';
  /** Sessions signed out, this one excluded. Only set on success. */
  otherSessionsEnded?: number;
}

/**
 * Changes a user's own password.
 *
 * The current password is re-checked even though the session already proved it
 * once: a change is exactly what a stolen cookie wants, and `keepSessionId` is
 * the one session that survives. Everything else is cut, so a password changed
 * because somebody else may have it actually ends their access rather than
 * leaving a 30-day cookie alive.
 *
 * Throttling is the caller's job -- this is a password oracle like `login()`
 * is, and it shares login's counter so guesses here cannot dodge that delay.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId: string
): Promise<PasswordChangeResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return { ok: false, reason: 'bad_current' };

  let currentOk = false;
  try {
    currentOk = await verify(user.passwordHash, currentPassword);
  } catch {
    currentOk = false;
  }
  if (!currentOk) return { ok: false, reason: 'bad_current' };

  if (newPassword.length < MIN_PASSWORD) return { ok: false, reason: 'too_short' };

  // Re-typing the temporary password would clear the must-change flag without
  // changing the thing the flag exists for.
  let sameAsBefore = false;
  try {
    sameAsBefore = await verify(user.passwordHash, newPassword);
  } catch {
    sameAsBefore = false;
  }
  if (sameAsBefore) return { ok: false, reason: 'unchanged' };

  await db
    .update(users)
    .set({
      passwordHash: await hash(newPassword),
      mustChangePassword: false,
      passwordChangedAt: new Date()
    })
    .where(eq(users.id, userId));

  const removed = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
    .returning({ id: sessions.id });

  return { ok: true, otherSessionsEnded: removed.length };
}
