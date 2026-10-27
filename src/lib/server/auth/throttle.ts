/**
 * Login throttling.
 *
 * Cloudflare Access is the outer gate and should stop an anonymous attacker
 * long before this runs. That is exactly why it exists: without it, Access is
 * the *only* brute-force control, and a misconfigured policy (a Bypass rule, an
 * application on the wrong hostname) turns straight into unlimited password
 * guessing against a single known account.
 *
 * The counts live in Postgres (`auth_throttle`). They were in process memory
 * while one web container served the app; that breaks the moment there are
 * two (each replica hands out its own allowance) and every restart wiped the
 * slate for whoever was guessing. The cost is one write per *failed* attempt
 * and one indexed read per attempt -- a successful sign-in only deletes.
 */
import { and, inArray, lt, max, gt, sql } from 'drizzle-orm';
import { db } from '../db';
import { authThrottle } from '../db/schema';

/** Attempts allowed before the delay starts. */
const FREE_ATTEMPTS = 5;

/** Base delay once the allowance is spent; doubles per failure, capped. */
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;

/** A quiet period this long clears the record entirely. */
const FORGET_MS = 60 * 60_000;

export interface ThrottleState {
  blocked: boolean;
  /** Seconds until the next attempt is allowed. Zero when not blocked. */
  retryAfterSeconds: number;
}

/**
 * Both the email and the client address are counted, so neither spraying one
 * password across many addresses nor hammering one account from many addresses
 * escapes the delay.
 */
function keysFor(email: string, ip: string): string[] {
  return [`email:${email.toLowerCase().trim()}`, `ip:${ip}`];
}

/** The delay after `failures` failed attempts; zero inside the allowance. */
export function delayFor(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (failures - FREE_ATTEMPTS - 1));
}

export async function checkThrottle(email: string, ip: string, now = new Date()): Promise<ThrottleState> {
  const [row] = await db
    .select({ until: max(authThrottle.blockedUntil) })
    .from(authThrottle)
    .where(and(inArray(authThrottle.key, keysFor(email, ip)), gt(authThrottle.blockedUntil, now)));
  const until = row?.until ? new Date(row.until).getTime() : 0;
  return until > now.getTime()
    ? { blocked: true, retryAfterSeconds: Math.ceil((until - now.getTime()) / 1000) }
    : { blocked: false, retryAfterSeconds: 0 };
}

export async function recordFailure(email: string, ip: string, now = new Date()): Promise<void> {
  const forgotten = new Date(now.getTime() - FORGET_MS);
  for (const key of keysFor(email, ip)) {
    // One statement, so two attempts landing together on two containers both
    // count: the increment happens in the row, not in either process. A record
    // quiet for an hour starts again from one.
    const [row] = await db
      .insert(authThrottle)
      .values({ key, failures: 1, lastSeen: now })
      .onConflictDoUpdate({
        target: authThrottle.key,
        set: {
          failures: sql`case when ${authThrottle.lastSeen} < ${forgotten.toISOString()} then 1 else ${authThrottle.failures} + 1 end`,
          lastSeen: now
        }
      })
      .returning({ failures: authThrottle.failures });
    const delay = delayFor(row.failures);
    if (delay) {
      await db
        .update(authThrottle)
        .set({ blockedUntil: new Date(now.getTime() + delay) })
        .where(sql`${authThrottle.key} = ${key}`);
    }
  }
  // Housekeeping rides on failures, the only thing that adds rows.
  await db.delete(authThrottle).where(lt(authThrottle.lastSeen, forgotten));
}

export async function recordSuccess(email: string, ip: string): Promise<void> {
  await db.delete(authThrottle).where(inArray(authThrottle.key, keysFor(email, ip)));
}

/**
 * The client address as seen through the tunnel. cloudflared sets
 * `cf-connecting-ip`; without it every request would carry the tunnel
 * container's address and one attacker would lock out the whole household.
 */
export function clientAddress(request: Request, fallback: string): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return fallback;
}
