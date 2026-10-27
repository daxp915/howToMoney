import { fail, redirect } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { verify } from '@node-rs/argon2';
import { db } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';
import { MIN_PASSWORD, SESSION_COOKIE, changePassword, listSessions } from '$lib/server/auth';
import { describeDevice, lastActive } from '$lib/device';
import { deleteAccount } from '$lib/server/accountData';
import {
  checkThrottle,
  clientAddress,
  recordFailure,
  recordSuccess
} from '$lib/server/auth/throttle';
import type { Actions, PageServerLoad } from './$types';

const ISSUER = 'howToMoney';

function tooManyAttempts(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return `Too many attempts. Try again in ${
    seconds < 60 ? `${seconds} seconds` : `${minutes} minute${minutes === 1 ? '' : 's'}`
  }.`;
}

function totpFor(secret: string, email: string): TOTP {
  return new TOTP({ issuer: ISSUER, label: email, secret, digits: 6, period: 30 });
}

export const load: PageServerLoad = async ({ locals, cookies }) => {
  const [user] = await db.select().from(users).where(eq(users.id, locals.user!.id));

  // A session id *is* the cookie, so it never leaves the server: the page gets
  // what the session is and whether it is this one, nothing it could replay.
  const current = cookies.get(SESSION_COOKIE);
  const now = new Date();
  const signedIn = (await listSessions(user.id)).map((s) => {
    const device = describeDevice(s.userAgent);
    const me = s.id === current;
    return {
      name: device.name,
      initials: device.initials,
      meta: me ? 'Now' : lastActive(s.lastSeenAt, now),
      me
    };
  });
  // This one first, then most recently active.
  signedIn.sort((a, b) => Number(b.me) - Number(a.me));

  const enrolled = !!user.totpConfirmedAt;

  // A secret that exists but was never confirmed is a half-finished enrollment;
  // show its QR again rather than making the user start over.
  let pending: { uri: string; svg: string; secret: string } | null = null;
  if (!enrolled && user.totpSecret) {
    const uri = totpFor(user.totpSecret, user.email).toString();
    pending = {
      uri,
      svg: await QRCode.toString(uri, { type: 'svg', margin: 1, width: 180 }),
      secret: user.totpSecret
    };
  }

  return {
    email: user.email,
    minPassword: MIN_PASSWORD,
    // Set by an admin creating the account or resetting it. hooks.server.ts
    // sends every other page here until it is cleared.
    mustChangePassword: user.mustChangePassword,
    passwordChangedAt: user.passwordChangedAt,
    enrolled,
    enrolledAt: user.totpConfirmedAt,
    pending,
    sessions: signedIn
  };
};

export const actions: Actions = {
  begin: async ({ locals }) => {
    const secret = new Secret({ size: 20 }).base32;
    await db.update(users).set({ totpSecret: secret }).where(eq(users.id, locals.user!.id));
    return { success: true, started: true };
  },

  confirm: async ({ request, locals }) => {
    const form = await request.formData();
    const code = String(form.get('code') ?? '').replace(/\s/g, '');

    const [user] = await db.select().from(users).where(eq(users.id, locals.user!.id));
    if (!user.totpSecret) return fail(400, { message: 'Start enrollment first.' });

    // window: 1 tolerates one 30-second step of clock drift either way.
    if (totpFor(user.totpSecret, user.email).validate({ token: code, window: 1 }) === null) {
      return fail(400, { message: 'That code did not match. Check your phone clock and try again.' });
    }

    await db
      .update(users)
      .set({ totpConfirmedAt: new Date() })
      .where(eq(users.id, locals.user!.id));

    return { success: true, confirmed: true };
  },

  disable: async ({ request, locals, getClientAddress }) => {
    const form = await request.formData();
    const password = String(form.get('password') ?? '');
    const me = locals.user!;
    const ip = clientAddress(request, getClientAddress());
    const throttle = await checkThrottle(me.email, ip);
    if (throttle.blocked) return fail(429, { message: tooManyAttempts(throttle.retryAfterSeconds) });

    // Turning off a second factor is exactly the action a stolen session would
    // want, so it re-checks the password rather than trusting the cookie.
    const [user] = await db.select().from(users).where(eq(users.id, locals.user!.id));
    let ok = false;
    try {
      ok = await verify(user.passwordHash, password);
    } catch {
      ok = false;
    }
    if (!ok) {
      await recordFailure(me.email, ip);
      return fail(400, { message: 'Password incorrect.' });
    }
    await recordSuccess(me.email, ip);

    await db
      .update(users)
      .set({ totpSecret: null, totpConfirmedAt: null })
      .where(eq(users.id, locals.user!.id));

    return { success: true, disabled: true };
  },

  changePassword: async ({ request, cookies, locals, getClientAddress }) => {
    const form = await request.formData();
    const current = String(form.get('current') ?? '');
    const next = String(form.get('next') ?? '');
    const confirmation = String(form.get('confirm') ?? '');

    // The surviving session. Losing the cookie mid-change would sign the user
    // out of the password they just set.
    const sessionId = cookies.get(SESSION_COOKIE);
    if (!sessionId) throw redirect(303, '/login');

    const me = locals.user!;
    const ip = clientAddress(request, getClientAddress());

    // Shares login's counter deliberately: this form takes the same password,
    // so guessing here has to cost the same as guessing there.
    const throttle = await checkThrottle(me.email, ip);
    if (throttle.blocked) return fail(429, { message: tooManyAttempts(throttle.retryAfterSeconds) });

    // Checked before the current password is verified, so a typo in the
    // confirmation box never counts against the allowance.
    if (next !== confirmation) {
      return fail(400, { message: 'The two new passwords do not match.' });
    }

    const result = await changePassword(me.id, current, next, sessionId);

    if (!result.ok) {
      if (result.reason === 'bad_current') await recordFailure(me.email, ip);
      return fail(400, {
        message:
          result.reason === 'too_short'
            ? `New password must be at least ${MIN_PASSWORD} characters.`
            : result.reason === 'unchanged'
              ? 'That is already your password. Choose a different one.'
              : 'Current password incorrect.'
      });
    }

    await recordSuccess(me.email, ip);
    return { success: true, passwordChanged: true, alsoSignedOut: result.otherSessionsEnded ?? 0 };
  },

  signOutOthers: async ({ cookies, locals }) => {
    const current = cookies.get(SESSION_COOKIE);
    if (!current) throw redirect(303, '/login');

    const removed = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, locals.user!.id), ne(sessions.id, current)))
      .returning({ id: sessions.id });

    return { success: true, signedOut: removed.length };
  },

  /** Deletes the account and everything in it; see deleteAccount(). */
  deleteAccount: async ({ request, locals, cookies, getClientAddress }) => {
    const form = await request.formData();
    const me = locals.user!;
    const ip = clientAddress(request, getClientAddress());
    // The same password again, so the same counter: a stolen session must not
    // get a second, unthrottled place to guess it.
    const throttle = await checkThrottle(me.email, ip);
    if (throttle.blocked) return fail(429, { message: tooManyAttempts(throttle.retryAfterSeconds) });
    const result = await deleteAccount(
      me.id,
      String(form.get('password') ?? ''),
      String(form.get('confirm') ?? '')
    );
    if (!result.ok) {
      if (result.badPassword) await recordFailure(me.email, ip);
      return fail(400, { message: result.message });
    }
    // The sessions went with the user (ON DELETE CASCADE); the cookie is all
    // that is left of this one.
    cookies.delete(SESSION_COOKIE, { path: '/' });
    throw redirect(303, '/login?deleted=1');
  }
};
