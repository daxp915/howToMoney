import { fail } from '@sveltejs/kit';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accountBalances, accounts, goals, transactions } from '$lib/server/db/schema';
import { accountDisplayName, lastFour } from '$lib/accountName';
import { drillHref } from '$lib/drill';
import { accountBalance, listGoals } from '$lib/server/goals';
import type { Actions } from './$types';

const STATUSES = new Set(['active', 'achieved', 'archived']);

function parseMoney(raw: FormDataEntryValue | null): number | null {
  const cleaned = String(raw ?? '').replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: FormDataEntryValue | null): Date | null {
  const v = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Goals: what it takes each month to keep every goal on schedule,
 * against what has actually moved (three-month average), then one list --
 * saved | bar | target -- with a tick where each goal needs to be today.
 *
 * The tick is linear from the day the goal was set (its `starting_amount`
 * snapshot, never recomputed) to the target on its date. Past the tick is on
 * pace (green); short of it is behind (yellow), by the difference.
 */
const DAY = 864e5;
const iso = (d: Date) => d.toLocaleDateString('en-CA');

export const loadGoals = async () => {
  const now = new Date();
  const rows = await listGoals(now);

  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname, orgName: accounts.orgName, type: accounts.type, balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .orderBy(asc(accounts.type), asc(accounts.name));

  // Moved in, last 3 months: the net of the linked account's own posted rows
  // over 90 whole days -- deposits less withdrawals on savings, payments less
  // charges on a loan.
  const linked = [...new Set(rows.map((g) => g.accountId).filter((id): id is string => !!id))];
  const since = new Date(now.getTime() - 90 * DAY);
  since.setHours(0, 0, 0, 0);
  const moved = linked.length
    ? await db
        .select({ id: transactions.accountId, net: sql<string>`sum(${transactions.amount})` })
        .from(transactions)
        .where(and(inArray(transactions.accountId, linked), gte(transactions.postedAt, since), eq(transactions.pending, false)))
        .groupBy(transactions.accountId)
    : [];
  const movedBy = new Map(moved.map((m) => [m.id, Number(m.net)]));

  // Balance history for the detail chart, from the daily snapshots.
  const hist = linked.length
    ? await db
        .select({ id: accountBalances.accountId, day: accountBalances.asOf, balance: accountBalances.balance })
        .from(accountBalances)
        .where(inArray(accountBalances.accountId, linked))
        .orderBy(asc(accountBalances.asOf))
    : [];

  const acctName = new Map(
    accountRows.map((a) => [a.id, { name: accountDisplayName(a), last4: lastFour(a.name), type: a.type }])
  );

  const shaped = rows.map((g) => {
    const span = g.target - g.starting;
    const end = g.targetDate?.getTime() ?? null;
    const start = g.createdAt.getTime();
    const elapsed = end && end > start ? Math.min(1, Math.max(0, (now.getTime() - start) / (end - start))) : null;
    const expected = elapsed === null ? null : g.starting + span * elapsed;
    // Positive = behind, in dollars toward the target.
    const behind = expected === null || span === 0 ? 0 : Math.max(0, (expected - g.current) * Math.sign(span));
    const a = g.accountId ? acctName.get(g.accountId) : null;
    const moved3 = g.accountId ? (movedBy.get(g.accountId) ?? 0) * Math.sign(span || 1) : null;
    return {
      ...g,
      tick: elapsed,
      behind: g.achieved || g.status !== 'active' ? 0 : behind,
      needed: g.requiredPerMonth ?? 0,
      moved3,
      account: a ? `${a.name}${a.last4 ? ` ··${a.last4}` : ''}` : null,
      emoji: g.direction === 'payoff' ? (a?.type === 'loan' ? '🚗' : '💳') : '🎯',
      movedHref: g.accountId ? drillHref({ account: g.accountId, from: iso(since), settled: true }) : null,
      history: g.accountId
        ? hist
            .filter((h) => h.id === g.accountId && new Date(h.day) >= new Date(iso(g.createdAt)))
            .map((h) => ({ day: String(h.day), value: Number(h.balance) }))
        : []
    };
  });

  const active = shaped.filter((g) => g.status === 'active' && !g.achieved);
  const needed = active.reduce((s, g) => s + g.needed, 0);
  const movedAvg = active.reduce((s, g) => s + Math.max(0, (g.moved3 ?? 0) / 3), 0);
  const worst = [...active].sort((a, b) => b.needed - (b.moved3 ?? 0) / 3 - (a.needed - (a.moved3 ?? 0) / 3))[0];

  return {
    active,
    reached: shaped.filter((g) => g.achieved || g.status === 'achieved'),
    hero: { needed, movedAvg, short: Math.max(0, needed - movedAvg), mostly: worst?.name ?? null, count: active.length },
    accounts: accountRows.map((a) => ({
      id: a.id,
      label: accountDisplayName(a),
      type: a.type,
      balance: Number(a.balance ?? 0)
    }))
  };
};

export const goalActions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim();
    const target = parseMoney(form.get('target'));
    const accountId = String(form.get('accountId') ?? '').trim() || null;
    const startingRaw = parseMoney(form.get('starting'));
    const targetDate = parseDate(form.get('targetDate'));
    const note = String(form.get('note') ?? '').trim() || null;

    if (!name) return fail(400, { message: 'Give the goal a name.' });
    if (target === null) return fail(400, { message: 'Enter a target amount.' });

    // A linked goal snapshots the account's balance now, so progress is
    // measured from the day the goal was set rather than from zero -- otherwise
    // an account that already holds $8,000 shows a $10,000 goal as 80% done on
    // day one and the pace figure is meaningless.
    const starting = accountId ? await accountBalance(accountId) : (startingRaw ?? 0);

    if (starting === target) {
      return fail(400, { message: 'The target is already where the balance is.' });
    }

    const [{ value: maxSort } = { value: 0 }] = await db
      .select({ value: sql<number>`coalesce(max(${goals.sortOrder}), 0)` })
      .from(goals);

    await db.insert(goals).values({
      name,
      targetAmount: target.toFixed(2),
      startingAmount: starting.toFixed(2),
      targetDate,
      accountId,
      manualAmount: accountId ? null : starting.toFixed(2),
      note,
      sortOrder: maxSort + 1
    });

    return { success: true, created: name };
  },

  update: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!id) return fail(400, { message: 'Missing goal.' });

    const [existing] = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
    if (!existing) return fail(404, { message: 'That goal no longer exists.' });

    const patch: Partial<typeof goals.$inferInsert> = { updatedAt: new Date() };

    if (form.has('name')) {
      const name = String(form.get('name') ?? '').trim();
      if (!name) return fail(400, { message: 'Give the goal a name.' });
      patch.name = name;
    }

    if (form.has('target')) {
      const target = parseMoney(form.get('target'));
      if (target === null) return fail(400, { message: 'Enter a target amount.' });
      patch.targetAmount = target.toFixed(2);
    }

    if (form.has('current')) {
      if (existing.accountId) {
        return fail(400, { message: 'This goal tracks an account, so its balance comes from sync.' });
      }
      const current = parseMoney(form.get('current'));
      if (current === null) return fail(400, { message: 'Enter the amount saved so far.' });
      patch.manualAmount = current.toFixed(2);
    }

    if (form.has('targetDate')) {
      patch.targetDate = parseDate(form.get('targetDate'));
    }

    if (form.has('note')) {
      patch.note = String(form.get('note') ?? '').trim() || null;
    }

    await db.update(goals).set(patch).where(eq(goals.id, id));
    return { success: true };
  },

  status: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const status = String(form.get('status') ?? '');
    if (!id || !STATUSES.has(status)) return fail(400, { message: 'Unknown goal status.' });

    await db.update(goals).set({ status, updatedAt: new Date() }).where(eq(goals.id, id));
    return { success: true };
  },

  remove: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!id) return fail(400, { message: 'Missing goal.' });

    await db.delete(goals).where(eq(goals.id, id));
    return { success: true };
  }
};
