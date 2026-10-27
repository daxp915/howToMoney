import { fail, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, createSession, login } from '$lib/server/auth';
import {
  checkThrottle,
  clientAddress,
  recordFailure,
  recordSuccess
} from '$lib/server/auth/throttle';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies, url, getClientAddress }) => {
    const form = await request.formData();
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const totp = String(form.get('totp') ?? '');

    const ip = clientAddress(request, getClientAddress());

    // Checked before the password is verified, so a blocked attacker cannot use
    // the response time to tell a real account from a missing one.
    const throttle = await checkThrottle(email, ip);
    if (throttle.blocked) {
      // `retryAfter` drives the button's live countdown; the message is what a
      // page without JavaScript shows.
      const minutes = Math.ceil(throttle.retryAfterSeconds / 60);
      return fail(429, {
        email,
        needsTotp: false,
        field: null,
        retryAfter: throttle.retryAfterSeconds,
        message: `Too many attempts. Try again in ${
          throttle.retryAfterSeconds < 60 ? `${throttle.retryAfterSeconds} seconds` : `${minutes} minute${minutes === 1 ? '' : 's'}`
        }.`
      });
    }

    const result = await login(email, password, totp || undefined);

    if (!result.ok) {
      // A missing TOTP code is a half-finished login, not a guess: the password
      // was already right. Counting it would lock someone out of their own
      // account for fumbling the six digits.
      if (result.reason !== 'bad_totp') await recordFailure(email, ip);

      // A generic message for bad credentials; naming the wrong field would
      // confirm which accounts exist.
      // `field` is where the cursor goes back to: the code box for a missing
      // code, otherwise the password, which is cleared (the email is kept).
      return fail(400, {
        email,
        needsTotp: result.reason === 'bad_totp',
        field: result.reason === 'bad_totp' ? ('totp' as const) : ('password' as const),
        retryAfter: 0,
        message:
          result.reason === 'bad_totp'
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'Incorrect email or password.'
      });
    }

    await recordSuccess(email, ip);

    const session = await createSession(result.userId!, request.headers.get('user-agent'));
    cookies.set(SESSION_COOKIE, session.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      // Served only over HTTPS through the Cloudflare tunnel in production.
      secure: process.env.NODE_ENV === 'production',
      expires: session.expiresAt
    });

    // `startsWith('/')` alone is not enough: browsers read `//evil.com` and
    // `/\evil.com` as protocol-relative URLs and leave the site entirely, which
    // turns the post-login hop into a phishing redirect. Require a single
    // leading slash followed by something that is not a slash or backslash.
    const next = url.searchParams.get('next');
    throw redirect(303, next && /^\/(?![/\\])/.test(next) ? next : '/');
  }
};
