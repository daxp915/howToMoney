import { fail, redirect } from '@sveltejs/kit';
import { MIN_PASSWORD, SESSION_COOKIE, createSession } from '$lib/server/auth';
import { checkThrottle, clientAddress, recordFailure, recordSuccess } from '$lib/server/auth/throttle';
import { attachInviteUser, redeemInvite, releaseInvite } from '$lib/server/invites';
import { createUser, emailExists } from '$lib/server/users';
import type { Actions, PageServerLoad } from './$types';

/**
 * Registration, by invite only.
 *
 * The code is checked, claimed and -- if anything afterwards fails -- put back.
 * A code burned by a failed attempt is a support call, and this flow exists
 * precisely so that nobody needs support to use it.
 */

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) throw redirect(303, '/');
  // Linking straight to /register?code=... saves the least reliable step of the
  // whole flow: a person retyping fifteen characters from a message.
  return { code: url.searchParams.get('code') ?? '' };
};

const FAILURE_MESSAGE: Record<string, string> = {
  unknown: 'That code wasn’t recognized. Check it and try again.',
  used: 'That code has already been used. Ask for a new one.',
  expired: 'That code has expired. Ask for a new one.',
  wrong_email: 'That invite code was issued for a different email address.'
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const form = await request.formData();
    const code = String(form.get('code') ?? '').trim();
    const email = String(form.get('email') ?? '')
      .toLowerCase()
      .trim();
    const password = String(form.get('password') ?? '');

    // `field` puts the message under the field it is about (handoff 4d);
    // null means a form-level problem. `retryAfter` drives the throttled
    // button's countdown.
    // No "password again": v2's field has Show, which catches the typo a
    // second box was there to catch.
    type Field = 'code' | 'email' | 'password' | null;
    const values = { code, email, retryAfter: 0 };
    const bad = (field: Field, message: string, status = 400) =>
      fail(status, { ...values, field, message });
    const ip = clientAddress(request, getClientAddress());

    // Same throttle as login, for the same reason: without it, the form is an
    // oracle for guessing invite codes.
    const throttle = await checkThrottle(`register:${email}`, ip);
    if (throttle.blocked) {
      const minutes = Math.ceil(throttle.retryAfterSeconds / 60);
      return fail(429, {
        ...values,
        field: null as Field,
        retryAfter: throttle.retryAfterSeconds,
        message: `Too many attempts. Try again in ${
          throttle.retryAfterSeconds < 60
            ? `${throttle.retryAfterSeconds} seconds`
            : `${minutes} minute${minutes === 1 ? '' : 's'}`
        }.`
      });
    }

    if (!code) return bad('code', 'Enter the invite code you were sent.');
    if (!email.includes('@')) return bad('email', 'Enter your email address.');
    if (password.length < MIN_PASSWORD) {
      return bad(
        'password',
        `Your password needs at least ${MIN_PASSWORD} characters. A short sentence works well.`
      );
    }

    // Checked before the code is claimed, so a typo in the email does not burn
    // the invite.
    if (await emailExists(email)) {
      return bad('email', 'There’s already an account with that email. Log in instead.');
    }

    const claim = await redeemInvite(code, email);
    if (!claim.ok) {
      await recordFailure(`register:${email}`, ip);
      return bad(claim.reason === 'wrong_email' ? 'email' : 'code', FAILURE_MESSAGE[claim.reason]);
    }

    let userId: string;
    try {
      // The person chose this password themselves, so there is no forced change
      // -- that flag is for a password somebody else picked. They do land in the
      // guided setup, because an account with no bank connected has nothing to
      // show yet.
      const created = await createUser({
        email,
        password,
        mustChangePassword: false,
        onboarded: false
      });
      userId = created.id;
    } catch (e) {
      // Put the code back: whatever went wrong here is not the invitee's doing.
      await releaseInvite(claim.inviteId);
      console.error('[register] account creation failed', e);
      return bad(null, 'Something went wrong creating the account. Please try again.', 500);
    }

    await attachInviteUser(claim.inviteId, userId);
    await recordSuccess(`register:${email}`, ip);

    const session = await createSession(userId, request.headers.get('user-agent'));
    cookies.set(SESSION_COOKIE, session.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: session.expiresAt
    });

    throw redirect(303, '/welcome');
  }
};
