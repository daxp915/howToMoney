import { fail, redirect } from '@sveltejs/kit';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts, categories, plaidItems, providerCredentials, transactions } from '$lib/server/db/schema';
import { plaidConfigured } from '$lib/server/plaid/client';
import { setBudget } from '$lib/server/budgets';
import { cashFlowScope, incomeSide, spendingSide } from '$lib/server/cashflow';
import { accountDisplayName, institutionName, lastFour } from '$lib/accountName';
import { claimToken } from '$lib/server/simplefin/claim';
import { runSync } from '$lib/server/sync/sync';
import { markOnboarded } from '$lib/server/users';
import type { Actions, PageServerLoad } from './$types';

/**
 * The guided setup a new account lands in.
 *
 * It is written for somebody who has never heard of SimpleFIN and is not going
 * to enjoy finding out: one action per screen, plain words, and a step that can
 * be left half-finished and picked up later. Which step you are on is derived
 * from what actually exists -- a credential, then accounts -- rather than from a
 * counter in the session, so closing the tab loses nothing and refreshing never
 * repeats work.
 */

export const load: PageServerLoad = async ({ locals, url }) => {
  const [credential] = await db
    .select({ id: providerCredentials.id, label: providerCredentials.label })
    .from(providerCredentials)
    .where(eq(providerCredentials.provider, 'simplefin'))
    .limit(1);

  const linked = await db
    .select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname, orgName: accounts.orgName, type: accounts.type, lastSyncedAt: accounts.lastSyncedAt })
    .from(accounts)
    .orderBy(accounts.type, accounts.name);
  const items = await db.select({ id: plaidItems.id }).from(plaidItems).limit(1);

  // , four steps: 1 welcome, 2 connect, 3 read the history, 4 a
  // starting budget. `?step=` moves freely up to the first step whose work is
  // not done -- derived from what exists, so closing the tab loses nothing.
  // Connected means a SimpleFIN credential or at least one Plaid bank.
  const connected = !!credential || items.length > 0;
  const synced = linked.some((a) => a.lastSyncedAt);
  const reached = !connected ? 2 : synced ? 4 : 3;
  const requested = Number(url.searchParams.get('step') ?? 0);
  const step = requested >= 1 && requested <= reached ? requested : !connected ? 1 : reached;

  return {
    step,
    reached,
    connected,
    plaidEnabled: plaidConfigured(),
    viaPlaid: items.length > 0 && !credential,
    accounts: linked.map((a) => ({
      id: a.id,
      name: accountDisplayName(a, locals.user?.email ?? null),
      last4: lastFour(a.name),
      institution: institutionName(a.orgName),
      synced: !!a.lastSyncedAt
    })),
    alreadyOnboarded: !!locals.user?.onboardedAt,
    proposal: step === 4 ? await proposeBudget() : null
  };
};

/**
 * Step 4's starting budget: what each category cost on average over the
 * last three months, rounded up to the next $10, biggest first. HTMFD has the
 * history by now, so it proposes rather than asking for numbers from scratch.
 */
async function proposeBudget() {
  const since = new Date(Date.now() - 90 * 864e5);
  since.setHours(0, 0, 0, 0);
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      icon: categories.icon,
      spent: sql<string>`sum(-${transactions.amount})`
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(cashFlowScope(), spendingSide(), gte(transactions.postedAt, since), eq(categories.group, 'expense')))
    .groupBy(categories.id, categories.name, categories.icon);
  const [inc] = await db
    .select({ income: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(cashFlowScope(), incomeSide(), gte(transactions.postedAt, since)));
  const lines = rows
    .map((r) => ({ id: r.id, name: r.name, icon: r.icon, amount: Math.ceil(Number(r.spent) / 3 / 10) * 10 }))
    .filter((r) => r.amount >= 10 && r.name !== 'Uncategorized')
    .sort((a, b) => b.amount - a.amount);
  return { lines, income: Math.round(Number(inc?.income ?? 0) / 3) };
}

export const actions: Actions = {
  /**
   * Step 2: exchange the one-time setup token for a stored access URL, then
   * go straight on to reading the history, which names every account found.
   * A rejected token comes back with the token still in the field.
   */
  claim: async ({ request }) => {
    const token = String((await request.formData()).get('token') ?? '');
    const r = await claimToken(token, 'connected during setup');
    if (!r.ok) return fail(400, { token, tokenError: { message: r.message, newToken: r.newToken } });
    throw redirect(303, '/welcome?step=3');
  },

  /** Step 4: the first pull of history. */
  sync: async ({ locals }) => {
    try {
      let summary = await runSync({ userId: locals.user!.id, days: 89 });
      // A bank connected through Plaid seconds ago may not have its history
      // ready yet (Plaid fetches it after Link closes). A few short retries
      // turn "0 transactions" into the real first screen most of the time;
      // the scheduled sync picks up whatever arrives later.
      const plaid = await db.select({ id: plaidItems.id }).from(plaidItems).limit(1);
      for (let i = 0; plaid.length && summary.inserted === 0 && i < 3; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        summary = await runSync({ userId: locals.user!.id, days: 89 });
      }
      return {
        success: true,
        synced: summary.accountsSynced,
        inserted: summary.inserted,
        categorized: summary.categorized
      };
    } catch (e) {
      console.error('[welcome] first sync failed', e);
      return fail(400, {
        message:
          (e instanceof Error ? e.message : 'The first sync did not finish.') +
          ' Your connection is saved, so you can try again.'
      });
    }
  },

  /** Step 4: "Use this budget" -- one monthly limit per category. */
  budget: async ({ request, locals }) => {
    const form = await request.formData();
    for (const [k, v] of form.entries()) {
      if (!k.startsWith('b:')) continue;
      const amount = Number(String(v).replace(/[$,\s]/g, ''));
      if (Number.isFinite(amount) && amount > 0) await setBudget(k.slice(2), amount, null);
    }
    await markOnboarded(locals.user!.id);
    throw redirect(303, '/');
  },

  /** "Start from zero", or done without a budget. */
  finish: async ({ locals }) => {
    await markOnboarded(locals.user!.id);
    throw redirect(303, '/');
  },

  /** "Import a file instead": setup ends here and the file import opens. */
  importInstead: async ({ locals }) => {
    await markOnboarded(locals.user!.id);
    throw redirect(303, '/settings/import');
  }
};
