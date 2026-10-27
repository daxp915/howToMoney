/**
 * Invite codes — the only way a new account comes into existence.
 *
 * Registration is deliberately not open. Cloudflare Access already stands in
 * front of the app, but its policy is an email allowlist: anything behind it is
 * reachable by every address on that list, including one added by mistake. An
 * invite is a second, deliberate act, and it is per person rather than per
 * policy.
 *
 * Everything here goes through `systemDb`. An invite is consumed before the
 * user it creates exists, so there is no `app.user_id` to scope to and no
 * tenant policy that could apply.
 */
import crypto from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { systemDb } from './db';
import { invites, users } from './db/schema';

const DEFAULT_TTL_DAYS = 14;

/** Unambiguous in handwriting and over the phone: no O/0, I/1, U/V confusion. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTWXYZ23456789';

export interface InviteRow {
  id: string;
  email: string | null;
  note: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  usedByEmail: string | null;
  status: 'open' | 'used' | 'expired';
}

function generateCode(): string {
  // ~73 bits across 15 characters. The code is a bearer secret for one account,
  // so it is generated from a CSPRNG and never derived from anything guessable.
  const bytes = crypto.randomBytes(15);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return `HTM-${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}-${chars.slice(10, 15).join('')}`;
}

/**
 * The stored form of a code.
 *
 * A plain SHA-256 rather than a password hash, and that is not an oversight: a
 * password is short and human-chosen, so it needs a slow hash to survive a
 * dump. These codes are 73 bits of randomness -- there is no dictionary to try,
 * and a slow hash would only make redemption slow.
 */
function hashCode(code: string): string {
  return crypto.createHash('sha256').update(normalize(code)).digest('hex');
}

/** Typed by a person who may not match the case or the dashes we printed. */
function normalize(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

export async function createInvite(opts: {
  createdBy: string;
  email?: string | null;
  note?: string | null;
  ttlDays?: number;
}): Promise<{ code: string; expiresAt: Date }> {
  const code = generateCode();
  const ttl = opts.ttlDays ?? DEFAULT_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);

  await systemDb.insert(invites).values({
    codeHash: hashCode(code),
    email: opts.email?.toLowerCase().trim() || null,
    note: opts.note?.trim() || null,
    createdBy: opts.createdBy,
    expiresAt
  });

  // The only time the plaintext exists. It is not recoverable afterwards, which
  // is the point of storing a hash; a lost code is revoked and reissued.
  return { code, expiresAt };
}

export type RedeemFailure = 'unknown' | 'used' | 'expired' | 'wrong_email';

/**
 * Claims a code for `email`, atomically.
 *
 * The `used_at IS NULL` condition lives in the UPDATE rather than in a prior
 * SELECT: two people submitting the same code at the same moment would both
 * pass a check-then-write, and both would get an account. Here exactly one
 * UPDATE returns a row.
 *
 * Call this *after* confirming the email is free, and release it if account
 * creation then fails -- a code burned by a failed attempt is a support call.
 */
export async function redeemInvite(
  code: string,
  email: string
): Promise<{ ok: true; inviteId: string } | { ok: false; reason: RedeemFailure }> {
  const codeHash = hashCode(code);

  const [row] = await systemDb
    .select({
      id: invites.id,
      email: invites.email,
      expiresAt: invites.expiresAt,
      usedAt: invites.usedAt
    })
    .from(invites)
    .where(eq(invites.codeHash, codeHash))
    .limit(1);

  if (!row) return { ok: false, reason: 'unknown' };
  if (row.usedAt) return { ok: false, reason: 'used' };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };
  if (row.email && row.email !== email.toLowerCase().trim()) {
    return { ok: false, reason: 'wrong_email' };
  }

  const claimed = await systemDb
    .update(invites)
    .set({ usedAt: new Date() })
    .where(and(eq(invites.id, row.id), isNull(invites.usedAt)))
    .returning({ id: invites.id });

  // Lost the race to another request holding the same code.
  if (!claimed.length) return { ok: false, reason: 'used' };

  return { ok: true, inviteId: row.id };
}

/** Records who the redeemed invite became, once the account exists. */
export async function attachInviteUser(inviteId: string, userId: string): Promise<void> {
  await systemDb.update(invites).set({ usedBy: userId }).where(eq(invites.id, inviteId));
}

/** Puts a code back after account creation failed, so it is not burned. */
export async function releaseInvite(inviteId: string): Promise<void> {
  await systemDb
    .update(invites)
    .set({ usedAt: null, usedBy: null })
    .where(eq(invites.id, inviteId));
}

export async function listInvites(): Promise<InviteRow[]> {
  const rows = await systemDb
    .select({
      id: invites.id,
      email: invites.email,
      note: invites.note,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
      usedAt: invites.usedAt,
      usedByEmail: users.email
    })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.usedBy))
    .orderBy(desc(invites.createdAt));

  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    status: r.usedAt ? 'used' : r.expiresAt.getTime() < now ? 'expired' : 'open'
  }));
}

/** Revoking an unused code is a delete: there is nothing to keep. */
export async function revokeInvite(id: string): Promise<void> {
  await systemDb.delete(invites).where(and(eq(invites.id, id), isNull(invites.usedAt)));
}

/** Tidies codes nobody used, so the list stays the list of live invitations. */
export async function purgeExpiredInvites(): Promise<number> {
  const removed = await systemDb
    .delete(invites)
    .where(and(isNull(invites.usedAt), sql`${invites.expiresAt} < now()`))
    .returning({ id: invites.id });
  return removed.length;
}
