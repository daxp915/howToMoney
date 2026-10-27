import { fail, redirect } from '@sveltejs/kit';
import { DEFAULT_FLOOR, ledger, outlook, setUserFloor, userFloor } from '$lib/server/advisor/facts';
import { count, eq } from 'drizzle-orm';
import { TABS } from '$lib/preferences';
import { db } from '$lib/server/db';
import { accounts, categories, rules, users } from '$lib/server/db/schema';
import { systemDb } from '$lib/server/db';
import { getPreferences, savePreferences } from '$lib/server/preferences';
import { alertsConfigured, emailAlertsOn, setEmailAlerts } from '$lib/server/alerts';
import type { Actions, PageServerLoad } from './$types';

/** The account the forecast follows (where the pay lands), so the Advisor
 *  card names the same one 7b draws. A failure costs only the name. */
async function forecastAccount(): Promise<string | null> {
  try {
    return (await outlook(await ledger(), 1)).account?.name ?? null;
  } catch {
    return null;
  }
}

export const load: PageServerLoad = async ({ locals }) => {
  const [prefs, floor, floorAccount, [cats], [rls], [accts], banks, emailAlerts] = await Promise.all([
    getPreferences(),
    userFloor(),
    forecastAccount(),
    db.select({ n: count() }).from(categories),
    db.select({ n: count() }).from(rules),
    db.select({ n: count() }).from(accounts).where(eq(accounts.isActive, true)),
    db.selectDistinct({ org: accounts.orgName }).from(accounts).where(eq(accounts.isActive, true)),
    emailAlertsOn()
  ]);
  // People is the admin's list of everyone, a cross-tenant question: systemDb.
  const people = locals.user?.isAdmin ? (await systemDb.select({ n: count() }).from(users))[0]?.n ?? 0 : null;
  return {
    preferences: prefs,
    floor,
    defaultFloor: DEFAULT_FLOOR,
    floorAccount,
    alerts: { on: emailAlerts, configured: alertsConfigured(), to: locals.user?.email ?? null },
    counts: { categories: cats?.n ?? 0, rules: rls?.n ?? 0, accounts: accts?.n ?? 0, banks: banks.length, people }
  };
};

/** Only ids the app actually knows are stored; anything else is ignored. */
const knownTabs = new Set(TABS.filter((t) => !t.fixed).map((t) => t.href));

export const actions: Actions = {
  tabs: async ({ request }) => {
    const form = await request.formData();
    const shown = new Set(form.getAll('tab').map(String));
    const hiddenTabs = [...knownTabs].filter((href) => !shown.has(href));

    await savePreferences({ hiddenTabs });
    return { success: true, saved: 'tabs' };
  },

  /** "Email me when a connection breaks". */
  alerts: async ({ request }) => {
    const on = (await request.formData()).get('on') === '1';
    await setEmailAlerts(on);
    return { success: true, saved: 'alerts' };
  },

  // Tips you cannot get back are tips nobody dares to dismiss.
  replayTour: async () => {
    await savePreferences({ tourSeenAt: null, dismissedTips: [] });
    throw redirect(303, '/');
  },

  // The Advisor's cash floor (9d). $0 is allowed and turns the warning off;
  // blank is an error rather than a silent reset. `reset` goes back to the
  // default ("Back to $500").
  floor: async ({ request }) => {
    const form = await request.formData();
    if (form.get('reset')) {
      await setUserFloor(null);
      return { success: true, saved: 'floor' };
    }
    const raw = String(form.get('floor') ?? '')
      .replace(/[$,\s]/g, '')
      .trim();
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
      return fail(400, { floorError: 'Enter an amount, $0 or more. $0 turns the warning off.' });
    }
    await setUserFloor(value === DEFAULT_FLOOR ? null : value);
    return { success: true, saved: 'floor' };
  },

  reset: async () => {
    await savePreferences({ hiddenTabs: [], dashboardCards: null, hiddenCards: [] });
    return { success: true, saved: 'reset' };
  }
};
