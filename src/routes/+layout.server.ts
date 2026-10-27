import { redirect } from '@sveltejs/kit';
import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts, transactions } from '$lib/server/db/schema';
import { getPreferences } from '$lib/server/preferences';
import { isHiddenRoute } from '$lib/preferences';
import { loadConnectionIssues } from '$lib/server/connectionHealth';
import { issuesSignature, SNOOZE_COOKIE, type ConnectionIssue } from '$lib/connectionHealth';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
  if (!locals.user) {
    return {
      user: null,
      reviewCount: 0,
      connectionProblem: false,
      connectionIssues: [] as ConnectionIssue[],
      connectionSnoozed: false,
      hasAccounts: false,
      preferences: { hiddenTabs: [], dashboardCards: null, hiddenCards: [], tourSeenAt: null, dismissedTips: [] as string[] }
    };
  }

  const preferences = await getPreferences();

  // Hiding a tab has to refuse its route as well. Removing the link alone
  // leaves a bookmark, a browser autocomplete and every old deep link walking
  // straight back into a feature somebody switched off.
  if (isHiddenRoute(url.pathname, preferences.hiddenTabs)) throw redirect(303, '/');

  // Home's badge (v2): rows nobody has marked as reviewed yet.
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .where(and(isNull(transactions.reviewedAt), eq(transactions.excluded, false)));

  // Every money page assumes accounts exist. Counting once here, rather than in
  // each of them, is what lets the layout put an explanation in their place.
  const [linked] = await db
    .select({ n: count() })
    .from(accounts)
    .where(eq(accounts.isActive, true));

  // A connection that needs the person: the yellow dot on the avatar, the
  // banner on every page, and the cards on Settings > Connections. It used to
  // be "an account not written for three days", which a bank whose sign-in
  // had failed never was -- SimpleFIN keeps returning it with the old balance.
  const issues = await loadConnectionIssues();
  // "Hide for today" covers exactly the problems it was pressed on; a new one
  // changes the signature and the banner returns.
  const snoozed = issues.length > 0 && cookies.get(SNOOZE_COOKIE) === issuesSignature(issues);

  return {
    user: locals.user,
    reviewCount: row?.n ?? 0,
    connectionProblem: issues.length > 0,
    connectionIssues: issues,
    connectionSnoozed: snoozed,
    hasAccounts: (linked?.n ?? 0) > 0,
    preferences
  };
};
