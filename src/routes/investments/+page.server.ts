import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts } from '$lib/server/db/schema';
import { moved } from '$lib/server/moved';
import type { PageServerLoad } from './$types';

// Investments is an account detail in Wealth now (v2): the first brokerage
// account, or Wealth itself when there is none.
export const load: PageServerLoad = async ({ url }) => {
  const [first] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.type, 'investment'), eq(accounts.isActive, true)))
    .orderBy(asc(accounts.name))
    .limit(1);
  moved(url, first ? `/wealth/${first.id}` : '/wealth');
};
