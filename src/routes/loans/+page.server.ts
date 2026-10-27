import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts } from '$lib/server/db/schema';
import { moved } from '$lib/server/moved';
import type { PageServerLoad } from './$types';

// Loans is an account detail in Wealth now (v2): the first loan still owed,
// or Wealth itself when every loan is paid off.
export const load: PageServerLoad = async ({ url }) => {
  const [first] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.type, 'loan'), eq(accounts.isActive, true), ne(accounts.balance, '0')))
    .orderBy(asc(accounts.name))
    .limit(1);
  moved(url, first ? `/wealth/${first.id}` : '/wealth');
};
