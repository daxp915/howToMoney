/**
 * Per-user display preferences.
 *
 * Read on every page render, so it is one indexed lookup by tenant and nothing
 * more. A user with no row yet is not an error: the defaults are the product's
 * opinion, and a row appears the first time somebody disagrees with it.
 */
import { db } from './db';
import { userPreferences } from './db/schema';

export interface Preferences {
  hiddenTabs: string[];
  dashboardCards: string[] | null;
  hiddenCards: string[];
  tourSeenAt: Date | null;
  /** v2 one-time tips put away with "Got it". */
  dismissedTips: string[];
}

const DEFAULTS: Preferences = {
  hiddenTabs: [],
  dashboardCards: null,
  hiddenCards: [],
  tourSeenAt: null,
  dismissedTips: []
};

export async function getPreferences(): Promise<Preferences> {
  const [row] = await db
    .select({
      hiddenTabs: userPreferences.hiddenTabs,
      dashboardCards: userPreferences.dashboardCards,
      hiddenCards: userPreferences.hiddenCards,
      tourSeenAt: userPreferences.tourSeenAt,
      dismissedTips: userPreferences.dismissedTips
    })
    .from(userPreferences)
    .limit(1);

  return row ? { ...DEFAULTS, ...row } : DEFAULTS;
}

/**
 * Upserts the current user's row.
 *
 * `user_id` comes from the row-level security default rather than from the
 * caller, and the conflict target names it, as every conflict target in this
 * schema must -- the unique index is on the tenant column.
 */
export async function savePreferences(patch: Partial<Preferences>): Promise<void> {
  await db
    .insert(userPreferences)
    .values({
      hiddenTabs: patch.hiddenTabs ?? DEFAULTS.hiddenTabs,
      dashboardCards: patch.dashboardCards ?? null,
      hiddenCards: patch.hiddenCards ?? DEFAULTS.hiddenCards,
      tourSeenAt: patch.tourSeenAt ?? null,
      dismissedTips: patch.dismissedTips ?? DEFAULTS.dismissedTips,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [userPreferences.userId],
      set: { ...patch, updatedAt: new Date() }
    });
}

/** Puts one tip away for good. Idempotent: a second "Got it" changes nothing. */
export async function dismissTip(id: string): Promise<void> {
  const { dismissedTips } = await getPreferences();
  if (dismissedTips.includes(id)) return;
  await savePreferences({ dismissedTips: [...dismissedTips, id] });
}
