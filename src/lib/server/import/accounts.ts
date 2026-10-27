import { eq } from 'drizzle-orm';
import { db } from '../db';
import { accounts } from '../db/schema';
import { accountDisplayName, lastFour } from '../../accountName';

/** "Everyday Checking ··4821", as Connections and Wealth name accounts. */
export async function accountChoices(email: string | null | undefined) {
  const rows = await db
    .select({ id: accounts.id, name: accounts.name, nickname: accounts.nickname, orgName: accounts.orgName, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.isActive, true))
    .orderBy(accounts.name);
  return rows.map((a) => {
    const last4 = lastFour(a.name);
    return { id: a.id, label: `${accountDisplayName(a, email ?? null)}${last4 ? ` ··${last4}` : ''}` };
  });
}
