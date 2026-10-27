import { fail } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts, categories, rules, transactions } from '$lib/server/db/schema';
import { categorizePending } from '$lib/server/ai/categorize';
import type { Actions, PageServerLoad } from './$types';

const MATCH_TYPES = new Set(['contains', 'equals', 'regex']);
const MATCH_FIELDS = new Set(['description', 'normalized']);

export const load: PageServerLoad = async () => {
  const ruleRows = await db
    .select({
      id: rules.id,
      name: rules.name,
      priority: rules.priority,
      matchField: rules.matchField,
      matchType: rules.matchType,
      matchValue: rules.matchValue,
      accountId: rules.accountId,
      amountMin: rules.amountMin,
      amountMax: rules.amountMax,
      setCategoryId: rules.setCategoryId,
      setMerchantName: rules.setMerchantName,
      setIsTransfer: rules.setIsTransfer,
      setExcluded: rules.setExcluded,
      enabled: rules.enabled,
      createdAt: rules.createdAt,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
      categoryGroup: categories.group,
      accountName: accounts.name
    })
    .from(rules)
    .leftJoin(categories, eq(categories.id, rules.setCategoryId))
    .leftJoin(accounts, eq(accounts.id, rules.accountId))
    .orderBy(asc(rules.priority), asc(rules.name));

  // How many transactions each rule matches today, by the same test the rule
  // engine applies (ruleMatches() in ai/categorize.ts): account, signed amount
  // bounds, then description or merchant key -- a plain substring for
  // `contains` (strpos, so % and _ stay literal), case-insensitive equality,
  // or a case-insensitive regex.
  //
  // Written as one raw query with its own aliases rather than a correlated
  // subquery over Drizzle columns, which can render unqualified and quietly
  // compare a column with itself.
  //
  // A pattern JavaScript accepts can still be one Postgres rejects, and a
  // failed statement aborts the request's whole transaction. The savepoint
  // confines that to this query: the page loads without counts instead of
  // failing.
  const matched = new Map<string, number>();
  try {
    const rows = await db.transaction(async (sp) =>
      sp.execute<{ id: string; n: number }>(sql`
        select r.id, count(t.id)::int as n
        from rules r
        left join transactions t
          on (r.account_id is null or t.account_id = r.account_id)
         and (r.amount_min is null or t.amount >= r.amount_min)
         and (r.amount_max is null or t.amount <= r.amount_max)
         and (
           case r.match_type
             when 'equals' then lower(case when r.match_field = 'normalized' then t.normalized_key else t.description end) = lower(r.match_value)
             when 'regex' then (case when r.match_field = 'normalized' then t.normalized_key else t.description end) ~* r.match_value
             else strpos(lower(case when r.match_field = 'normalized' then t.normalized_key else t.description end), lower(r.match_value)) > 0
           end
         )
        group by r.id`)
    );
    for (const r of rows) matched.set(r.id, Number(r.n));
  } catch (e) {
    console.warn('[rules] match counts unavailable:', e instanceof Error ? e.message : e);
  }

  return {
    rules: ruleRows.map((r) => ({ ...r, matched: matched.get(r.id) ?? null })),
    categoryOptions: await db
      .select({ id: categories.id, name: categories.name, icon: categories.icon })
      .from(categories)
      .orderBy(categories.sortOrder),
    accountOptions: await db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.isActive, true))
      .orderBy(accounts.name)
  };
};

function readRule(form: FormData) {
  const matchValue = String(form.get('matchValue') ?? '').trim();
  const matchType = String(form.get('matchType') ?? 'contains');
  const matchField = String(form.get('matchField') ?? 'description');

  if (!matchValue) return { error: 'Enter something to match on.' };
  if (!MATCH_TYPES.has(matchType)) return { error: 'Unknown match type.' };
  if (!MATCH_FIELDS.has(matchField)) return { error: 'Unknown field.' };

  if (matchType === 'regex') {
    try {
      new RegExp(matchValue, 'i');
    } catch (e) {
      // Catching it here means a bad pattern never reaches the sync loop, where
      // it would be swallowed per-transaction and silently match nothing.
      return { error: `Invalid regular expression: ${e instanceof Error ? e.message : e}` };
    }
  }

  const num = (k: string) => {
    const v = String(form.get(k) ?? '').replace(/[$,\s]/g, '');
    return v === '' ? null : Number(v);
  };
  const min = num('amountMin');
  const max = num('amountMax');
  if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
    return { error: 'Amount bounds must be numbers.' };
  }

  const setCategoryId = String(form.get('setCategoryId') ?? '') || null;
  const setIsTransfer = form.get('setIsTransfer') === 'on';
  const setExcluded = form.get('setExcluded') === 'on';
  const setMerchantName = String(form.get('setMerchantName') ?? '').trim() || null;

  if (!setCategoryId && !setIsTransfer && !setExcluded && !setMerchantName) {
    return { error: 'A rule has to do something: set a category, rename, mark transfer, or exclude.' };
  }

  return {
    values: {
      name: String(form.get('name') ?? '').trim() || matchValue,
      priority: Number(form.get('priority') ?? 100) || 100,
      matchField,
      matchType,
      matchValue,
      accountId: String(form.get('accountId') ?? '') || null,
      amountMin: min === null ? null : min.toFixed(2),
      amountMax: max === null ? null : max.toFixed(2),
      setCategoryId,
      setMerchantName,
      // Stored as null rather than false so the rule leaves the field alone
      // instead of actively setting it back.
      setIsTransfer: setIsTransfer ? true : null,
      setExcluded: setExcluded ? true : null,
      enabled: form.get('enabled') !== 'off'
    }
  };
}

export const actions: Actions = {
  create: async ({ request }) => {
    const parsed = readRule(await request.formData());
    if (parsed.error) return fail(400, { message: parsed.error });
    await db.insert(rules).values(parsed.values!);
    return { success: true };
  },

  update: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!id) return fail(400, { message: 'Missing rule.' });
    const parsed = readRule(form);
    if (parsed.error) return fail(400, { message: parsed.error });
    await db.update(rules).set(parsed.values!).where(eq(rules.id, id));
    return { success: true };
  },

  toggle: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    await db
      .update(rules)
      .set({ enabled: sql`not ${rules.enabled}` })
      .where(eq(rules.id, id));
    return { success: true };
  },

  remove: async ({ request }) => {
    const form = await request.formData();
    await db.delete(rules).where(eq(rules.id, String(form.get('id') ?? '')));
    return { success: true };
  },

  /** Dry run: how many transactions would this rule touch, without writing. */
  test: async ({ request }) => {
    const form = await request.formData();
    const parsed = readRule(form);
    if (parsed.error) return fail(400, { message: parsed.error });
    const v = parsed.values!;

    const field = v.matchField === 'normalized' ? transactions.normalizedKey : transactions.description;
    const predicate =
      v.matchType === 'equals'
        ? sql`lower(${field}) = lower(${v.matchValue})`
        : v.matchType === 'regex'
          ? sql`${field} ~* ${v.matchValue}`
          : sql`${field} ilike ${'%' + v.matchValue + '%'}`;

    const rows = await db
      .select({
        description: transactions.description,
        amount: transactions.amount,
        postedAt: transactions.postedAt
      })
      .from(transactions)
      .where(predicate)
      .limit(6);

    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .where(predicate);

    return { success: true, testCount: Number(n), testSample: rows };
  },

  /** Re-runs categorization so an edited rule applies to existing rows. */
  apply: async () => {
    // Rules only see transactions still at categorySource 'none', so anything
    // previously answered by the model has to be released first. User choices
    // are never touched.
    // Transfer legs are excluded: categorizePending skips is_transfer rows, so
    // releasing them would strand them at 'none' permanently.
    await db
      .update(transactions)
      .set({ categorySource: 'none', needsReview: false })
      .where(
        and(
          sql`${transactions.categorySource} in ('ai', 'memory', 'rule')`,
          eq(transactions.isTransfer, false)
        )
      );

    const result = await categorizePending(5000);
    return {
      success: true,
      applied: result.byRule,
      reclassified: result.byMemory + result.byAi,
      cost: result.usage.costUsd
    };
  }
};
