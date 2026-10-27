import { error, fail } from '@sveltejs/kit';
import { MIN_PASSWORD } from '$lib/server/auth';
import { createInvite, listInvites, purgeExpiredInvites, revokeInvite } from '$lib/server/invites';
import { createUser, deleteUser, listUsers, setAdmin, setPassword } from '$lib/server/users';
import { betaMetrics } from '$lib/server/beta';
import type { Actions, PageServerLoad } from './$types';

/** Every action here re-checks; a load guard alone would leave the POSTs open. */
function requireAdmin(locals: App.Locals) {
  if (!locals.user?.isAdmin) throw error(403, 'Admins only.');
  return locals.user;
}

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  return {
    users: await listUsers(),
    invites: await listInvites(),
    beta: await betaMetrics(),
    me: locals.user!.id,
    minPassword: MIN_PASSWORD
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const email = String(form.get('email') ?? '')
      .trim()
      .toLowerCase();
    const password = String(form.get('password') ?? '');
    const isAdmin = form.get('isAdmin') === 'on';

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return fail(400, { message: 'Enter a valid email address.' });
    }
    if (password.length < MIN_PASSWORD) {
      return fail(400, { message: `Password must be at least ${MIN_PASSWORD} characters.` });
    }

    try {
      await createUser({ email, password, isAdmin });
    } catch {
      return fail(400, { message: `Could not create ${email} — is that address already in use?` });
    }

    return { success: true, created: email };
  },

  invite: async ({ request, locals }) => {
    const me = requireAdmin(locals);
    const form = await request.formData();
    const email = String(form.get('email') ?? '')
      .trim()
      .toLowerCase();
    const note = String(form.get('note') ?? '').trim();
    const ttlDays = Number(form.get('ttlDays') ?? 14);

    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return fail(400, { message: 'That does not look like an email address.' });
    }
    if (!Number.isFinite(ttlDays) || ttlDays < 1 || ttlDays > 90) {
      return fail(400, { message: 'Choose an expiry between 1 and 90 days.' });
    }

    const { code, expiresAt } = await createInvite({
      createdBy: me.id,
      email: email || null,
      note: note || null,
      ttlDays
    });

    // Returned once and never again: only the hash is stored, so this is the
    // single moment the code can be copied.
    return { success: true, invite: { code, expiresAt: expiresAt.toISOString() } };
  },

  revokeInvite: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!id) return fail(400, { message: 'Missing invite.' });

    await revokeInvite(id);
    return { success: true, inviteRevoked: true };
  },

  purgeInvites: async ({ locals }) => {
    requireAdmin(locals);
    const removed = await purgeExpiredInvites();
    return { success: true, invitesPurged: removed };
  },

  password: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const password = String(form.get('password') ?? '');

    if (!id) return fail(400, { message: 'Missing user.' });
    if (password.length < MIN_PASSWORD) {
      return fail(400, { message: `Password must be at least ${MIN_PASSWORD} characters.` });
    }

    // Cuts every session that user holds, and leaves them on a forced change at
    // next sign-in -- an admin-typed password is a way back in, not a password.
    const signedOut = await setPassword(id, password);
    return { success: true, passwordSet: true, signedOut };
  },

  admin: async ({ request, locals }) => {
    const me = requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const makeAdmin = form.get('isAdmin') === 'true';

    if (!id) return fail(400, { message: 'Missing user.' });

    // Removing your own admin rights would leave nobody able to restore them
    // without a database console.
    if (id === me.id && !makeAdmin) {
      return fail(400, { message: 'You cannot remove your own admin access.' });
    }

    await setAdmin(id, makeAdmin);
    return { success: true };
  },

  remove: async ({ request, locals }) => {
    const me = requireAdmin(locals);
    const form = await request.formData();
    const id = String(form.get('id') ?? '');

    if (!id) return fail(400, { message: 'Missing user.' });
    if (id === me.id) return fail(400, { message: 'You cannot delete your own account.' });

    // Cascades through every table: accounts, transactions, budgets, goals,
    // rules, the learned merchant cache and their stored bank credentials.
    await deleteUser(id);
    return { success: true, removed: true };
  }
};
