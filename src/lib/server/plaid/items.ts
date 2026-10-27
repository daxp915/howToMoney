/**
 * Connecting and disconnecting a Plaid bank for the signed-in user. Row-level
 * security scopes every query; `user_id` defaults from the request's scope.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { accounts, plaidItems } from '../db/schema';
import { decryptSecret, encryptSecret } from '../crypto';
import { exchangePublicToken, removeItem } from './client';

/**
 * Trades Link's one-time public token for the long-lived access token and
 * stores it encrypted. Never logs the token. Re-linking the same bank (Plaid
 * returns the same item_id) replaces the token and keeps the cursor.
 */
export async function connectPlaidItem(
  publicToken: string,
  institution: { id?: string | null; name?: string | null } = {}
): Promise<{ itemId: string }> {
  const { access_token, item_id } = await exchangePublicToken(publicToken);
  const accessToken = encryptSecret(access_token);
  await db
    .insert(plaidItems)
    .values({
      itemId: item_id,
      accessToken,
      institutionId: institution.id ?? null,
      institutionName: institution.name?.trim() || null
    })
    .onConflictDoUpdate({
      target: [plaidItems.userId, plaidItems.itemId],
      set: { accessToken, errorCode: null }
    });
  return { itemId: item_id };
}

/**
 * Revokes the item at Plaid (which also stops billing for it) and forgets the
 * token. The accounts stay, deactivated, with their history -- "deactivate,
 * never delete", as for SimpleFIN accounts that disappear.
 */
export async function disconnectPlaidItem(id: string): Promise<void> {
  const [item] = await db.select().from(plaidItems).where(eq(plaidItems.id, id));
  if (!item) return;
  try {
    await removeItem(decryptSecret(item.accessToken));
  } catch (e) {
    // Already removed at Plaid, or Plaid unreachable: forget it locally either
    // way, but say so -- an item left alive at Plaid keeps billing.
    console.warn(`[plaid] /item/remove failed for ${item.itemId}: ${e instanceof Error ? e.message : e}`);
  }
  await db.delete(plaidItems).where(eq(plaidItems.id, id));
  // Without an item, nothing would ever update these balances again.
  // Only Plaid's accounts: the same bank may also be connected through SimpleFIN.
  if (item.institutionName) {
    await db
      .update(accounts)
      .set({ isActive: false })
      .where(and(eq(accounts.provider, 'plaid'), eq(accounts.orgName, item.institutionName)));
  }
}
