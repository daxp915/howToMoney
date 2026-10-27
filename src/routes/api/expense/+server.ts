import { error, json } from '@sveltejs/kit';
import { addManualTransaction, ensureCashAccount, manualAccounts } from '$lib/server/manual';
import { db } from '$lib/server/db';
import { categories } from '$lib/server/db/schema';
import { ne } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Hand-entered transactions.
 *
 * GET returns what the dialog needs to draw itself -- the accounts you may type
 * into, and the categories. POST writes one row. Both are JSON rather than form
 * actions because the dialog is opened from the dashboard, which has form
 * actions of its own and no business gaining a second set for this.
 */

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, 'Not authenticated');

  const [accounts, categoryRows] = await Promise.all([
    manualAccounts(),
    db
      .select({
        id: categories.id,
        name: categories.name,
        icon: categories.icon,
        color: categories.color
      })
      .from(categories)
      // Transfers are two real ledger entries created by the matcher, never one
      // row somebody types, so offering the group here would only produce
      // half-transfers that corrupt the balance.
      .where(ne(categories.group, 'transfer'))
      .orderBy(categories.sortOrder)
  ]);

  return json({ accounts, categories: categoryRows });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) throw error(401, 'Not authenticated');

  const body = (await request.json()) as {
    accountId?: string;
    amount?: number | string;
    merchant?: string;
    date?: string;
    categoryId?: string | null;
    note?: string | null;
    isIncome?: boolean;
    createCashAccount?: boolean;
  };

  // First entry on a fresh account has nowhere to go until there is a manual
  // account, so the dialog can ask for one to be made in the same press.
  const accountId = body.createCashAccount
    ? (await ensureCashAccount()).id
    : String(body.accountId ?? '');

  if (!accountId) throw error(400, 'Choose an account.');

  const amount = Number(String(body.amount ?? '').replace(/[$,\s]/g, ''));
  const date = body.date ? new Date(`${body.date}T12:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) throw error(400, 'That date did not make sense.');

  try {
    const result = await addManualTransaction({
      accountId,
      amount,
      merchant: String(body.merchant ?? ''),
      postedAt: date,
      categoryId: body.categoryId || null,
      note: body.note ?? null,
      isIncome: !!body.isIncome
    });
    return json(result, { status: 201 });
  } catch (e) {
    // These are all sentences meant for the person typing, not stack traces.
    throw error(400, e instanceof Error ? e.message : 'Could not save that.');
  }
};
