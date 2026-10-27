import { fail } from '@sveltejs/kit';
import { asc, count, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { categories, merchants, rules, transactions } from '$lib/server/db/schema';
import { categoryUsage } from '$lib/server/categoryUsage';
import { isBillName } from '$lib/server/plan';
import type { Actions, PageServerLoad } from './$types';

const GROUPS = new Set(['income', 'expense', 'transfer']);
const HEX = /^#[0-9a-fA-F]{6}$/;

export const load: PageServerLoad = async () => {
  // Usage counts drive the delete flow: a category nothing points at can go
  // without ceremony, one in use needs somewhere for its transactions to land.
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      group: categories.group,
      icon: categories.icon,
      color: categories.color,
      isSystem: categories.isSystem,
      sortOrder: categories.sortOrder
    })
    .from(categories)
    .orderBy(asc(categories.group), asc(categories.sortOrder), asc(categories.name));

  const usage = await categoryUsage();
  // "N this year".
  const yearRows = await db
    .select({ id: transactions.categoryId, n: count() })
    .from(transactions)
    .where(gte(transactions.postedAt, new Date(new Date().getFullYear(), 0, 1)))
    .groupBy(transactions.categoryId);
  const year = new Map(yearRows.map((r) => [r.id, r.n]));
  const recentSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  recentSince.setHours(0, 0, 0, 0);

  const [{ value: total } = { value: 0 }] = await db
    .select({ value: count() })
    .from(transactions);

  return {
    recentSince: recentSince.toLocaleDateString('en-CA'),
    categories: rows.map((c) => ({
      ...c,
      txnCount: usage.get(c.id)?.transactions ?? 0,
      recentCount: usage.get(c.id)?.recent ?? 0,
      merchantCount: usage.get(c.id)?.merchants ?? 0,
      ruleCount: usage.get(c.id)?.rules ?? 0,
      yearCount: year.get(c.id) ?? 0,
      bill: c.group === 'expense' && isBillName(c.name)
    })),
    totalTransactions: total,
    // Rows that have a category, which is what "filed" means on the page.
    filedTransactions: [...usage.values()].reduce((t, u) => t + u.transactions, 0)
  };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim();
    const group = String(form.get('group') ?? 'expense');
    const icon = String(form.get('icon') ?? '').trim() || null;
    const color = String(form.get('color') ?? '').trim();

    if (!name) return fail(400, { message: 'Name is required.' });
    if (!GROUPS.has(group)) return fail(400, { message: 'Unknown group.' });
    if (!HEX.test(color)) return fail(400, { message: 'Color must be a hex value like #3987e5.' });

    const [{ value: maxSort } = { value: 0 }] = await db
      .select({ value: sql<number>`coalesce(max(${categories.sortOrder}), 0)` })
      .from(categories);

    try {
      await db
        .insert(categories)
        .values({ name, group, icon, color, sortOrder: maxSort + 1, isSystem: false });
    } catch {
      return fail(400, { message: `A category named "${name}" already exists.` });
    }
    return { success: true, created: name };
  },

  update: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const name = String(form.get('name') ?? '').trim();
    const group = String(form.get('group') ?? 'expense');
    const icon = String(form.get('icon') ?? '').trim() || null;
    const color = String(form.get('color') ?? '').trim();

    if (!id || !name) return fail(400, { message: 'Name is required.' });
    if (!GROUPS.has(group)) return fail(400, { message: 'Unknown group.' });
    if (!HEX.test(color)) return fail(400, { message: 'Color must be a hex value like #3987e5.' });

    try {
      await db.update(categories).set({ name, group, icon, color }).where(eq(categories.id, id));
    } catch {
      return fail(400, { message: `A category named "${name}" already exists.` });
    }
    return { success: true, updated: name };
  },

  remove: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const replacementId = String(form.get('replacementId') ?? '');
    if (!id) return fail(400, { message: 'Missing category.' });
    if (replacementId === id) {
      return fail(400, { message: 'Pick a different category to move things to.' });
    }

    const [target] = await db.select().from(categories).where(eq(categories.id, id));
    if (!target) return fail(404, { message: 'Category not found.' });

    const replacement = replacementId || null;

    // Move everything that points at this category before dropping it. The
    // foreign keys would null these out on their own, but that silently
    // uncategorizes history; an explicit move is what the user expects and it
    // keeps learned merchant mappings and rules working.
    await db
      .update(transactions)
      .set({ categoryId: replacement, updatedAt: new Date() })
      .where(eq(transactions.categoryId, id));
    await db
      .update(merchants)
      .set({ categoryId: replacement, updatedAt: new Date() })
      .where(eq(merchants.categoryId, id));
    await db
      .update(rules)
      .set({ setCategoryId: replacement })
      .where(eq(rules.setCategoryId, id));

    await db.delete(categories).where(eq(categories.id, id));

    return { success: true, removed: target.name, movedTo: replacement };
  }
};
