/**
 * Plaid webhooks: Plaid tells us when a bank has new transactions or needs the
 * person again, instead of the app finding out on its next scheduled sync.
 *
 * The endpoint (`/api/plaid/webhook`) is public -- Plaid has no session -- so
 * the request authenticates itself. Plaid signs every webhook: the
 * `Plaid-Verification` header is an ES256 JWT whose key is fetched from Plaid
 * by its `kid`, and whose payload carries the SHA-256 of the exact body. A
 * request that fails any of that is dropped before it touches the database:
 * an unsigned "sync this item" would otherwise let anyone run up provider
 * calls, and an unsigned ITEM error would put a false "sign in again" banner
 * on someone's screen.
 *
 * Plaid's guidance, followed here: reject algorithms other than ES256, reject
 * a token older than five minutes, compare the body hash in constant time,
 * and cache keys by kid (a key Plaid reports expired is not used).
 */
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { systemDb } from '../db';
import { plaidItems } from '../db/schema';
import { webhookVerificationKey, type PlaidJwk } from './client';

const MAX_AGE_SECONDS = 5 * 60;

export type Verdict = { ok: true } | { ok: false; reason: string };

function b64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Checks a webhook's signature against its raw body. Pure apart from the key
 * lookup, which is passed in so the tests can sign with a key of their own.
 */
export async function verifyPlaidWebhook(
  body: string,
  token: string | null,
  getKey: (kid: string) => Promise<PlaidJwk | null>,
  now = Date.now()
): Promise<Verdict> {
  if (!token) return { ok: false, reason: 'no Plaid-Verification header' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'not a JWT' };

  let header: { alg?: string; kid?: string };
  let payload: { iat?: number; request_body_sha256?: string };
  try {
    header = JSON.parse(b64url(parts[0]).toString('utf8'));
    payload = JSON.parse(b64url(parts[1]).toString('utf8'));
  } catch {
    return { ok: false, reason: 'unreadable JWT' };
  }
  // Checked before anything else is trusted: "none" or an HMAC algorithm
  // would let the sender choose how the signature is checked.
  if (header.alg !== 'ES256') return { ok: false, reason: `algorithm ${header.alg ?? '(none)'}` };
  if (!header.kid) return { ok: false, reason: 'no key id' };

  const jwk = await getKey(header.kid);
  if (!jwk) return { ok: false, reason: 'unknown key' };
  if (jwk.expired_at) return { ok: false, reason: 'expired key' };

  let valid = false;
  try {
    const key = crypto.createPublicKey({
      key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      format: 'jwk'
    });
    valid = crypto.verify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key, dsaEncoding: 'ieee-p1363' },
      b64url(parts[2])
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad signature' };

  if (typeof payload.iat !== 'number' || now / 1000 - payload.iat > MAX_AGE_SECONDS) {
    return { ok: false, reason: 'too old' };
  }

  const want = Buffer.from(String(payload.request_body_sha256 ?? ''), 'utf8');
  const got = Buffer.from(crypto.createHash('sha256').update(body, 'utf8').digest('hex'), 'utf8');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) {
    return { ok: false, reason: 'body does not match its signature' };
  }
  return { ok: true };
}

/** Plaid's keys rotate rarely; one fetch per kid per process is plenty. */
const keys = new Map<string, PlaidJwk>();

/**
 * Key fetches allowed per minute. The kid comes from an unauthenticated
 * header, so without a cap anyone could make this server call Plaid once per
 * request by inventing kids. Real rotations need one fetch each.
 */
const FETCHES_PER_MINUTE = 5;
let fetchTimes: number[] = [];

export async function plaidKey(kid: string): Promise<PlaidJwk | null> {
  const cached = keys.get(kid);
  if (cached) return cached;
  const now = Date.now();
  fetchTimes = fetchTimes.filter((t) => now - t < 60_000);
  if (fetchTimes.length >= FETCHES_PER_MINUTE) return null;
  fetchTimes.push(now);
  try {
    const key = await webhookVerificationKey(kid);
    keys.set(kid, key);
    return key;
  } catch (e) {
    console.warn(`[plaid] could not fetch webhook key ${kid}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export interface PlaidWebhook {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string } | null;
}

/** What a verified webhook asks for. Pure, so the decision table is testable. */
export type WebhookAction =
  | { kind: 'sync' }
  | { kind: 'error'; code: string }
  | { kind: 'clear' }
  | { kind: 'ignore' };

export function webhookAction(w: PlaidWebhook): WebhookAction {
  const type = w.webhook_type;
  const code = w.webhook_code;
  if (type === 'TRANSACTIONS' && code === 'SYNC_UPDATES_AVAILABLE') return { kind: 'sync' };
  if (type === 'ITEM') {
    if (code === 'ERROR' && w.error?.error_code) return { kind: 'error', code: w.error.error_code };
    // The same codes the connection banner already explains (connectionHealth).
    if (code === 'PENDING_EXPIRATION' || code === 'PENDING_DISCONNECT') return { kind: 'error', code };
    if (code === 'USER_PERMISSION_REVOKED' || code === 'USER_ACCOUNT_REVOKED') {
      return { kind: 'error', code: 'ITEM_LOGIN_REQUIRED' };
    }
    if (code === 'LOGIN_REPAIRED') return { kind: 'clear' };
  }
  return { kind: 'ignore' };
}

/**
 * Applies a verified webhook. The item is looked up across tenants -- the
 * webhook names an item, not a user -- which is exactly what `systemDb` is
 * for; every write names both the item and its owner.
 *
 * Returns the owner to sync for, if the webhook asked for one.
 */
export async function applyPlaidWebhook(w: PlaidWebhook): Promise<{ syncUserId: string | null; action: WebhookAction['kind'] }> {
  const action = webhookAction(w);
  if (action.kind === 'ignore' || !w.item_id) return { syncUserId: null, action: 'ignore' };

  const [item] = await systemDb
    .select({ id: plaidItems.id, userId: plaidItems.userId })
    .from(plaidItems)
    .where(eq(plaidItems.itemId, w.item_id));
  // An item this server no longer holds (disconnected, account deleted).
  if (!item) return { syncUserId: null, action: 'ignore' };

  const mine = and(eq(plaidItems.id, item.id), eq(plaidItems.userId, item.userId));
  if (action.kind === 'error') await systemDb.update(plaidItems).set({ errorCode: action.code }).where(mine);
  if (action.kind === 'clear') await systemDb.update(plaidItems).set({ errorCode: null }).where(mine);
  return { syncUserId: action.kind === 'sync' ? item.userId : null, action: action.kind };
}
