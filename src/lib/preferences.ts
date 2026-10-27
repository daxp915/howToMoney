/**
 * What can be customized, and what it looks like switched off.
 *
 * Shared by the browser and the server: the settings page renders these lists,
 * the layout filters the nav by them, and the root load refuses a hidden route.
 * Keeping the catalogue in one non-server module is what keeps those three from
 * drifting apart.
 */

export interface TabDef {
  href: string;
  label: string;
  icon: string;
  /** Tabs the app cannot function without are not offered as choices. */
  fixed?: boolean;
  /** Not a destination in the nav: a layer reached from every screen. */
  layer?: boolean;
  description?: string;
}

/**
 * v2: four places, plus the Advisor as a layer (the ask bar and the phone's
 * Ask button) rather than a tab.
 *
 * Thirteen tabs folded into these. Each old route still answers and redirects
 * to where its content went (see the old route directories), so a bookmark
 * lands somewhere sensible rather than on a 404. Activity keeps the
 * /transactions URL because every drill-down link in the app already points
 * there.
 */
export const TABS: TabDef[] = [
  { href: '/', label: 'Home', icon: 'dashboard', fixed: true },
  { href: '/transactions', label: 'Activity', icon: 'transactions', fixed: true },
  {
    href: '/plan',
    label: 'Plan',
    icon: 'budgets',
    description: 'Envelopes, recurring bills and goals'
  },
  {
    href: '/wealth',
    label: 'Wealth',
    icon: 'trending-up',
    description: 'Net worth, investments and loans'
  },
  {
    href: '/advisor',
    label: 'Advisor',
    icon: 'compass',
    layer: true,
    description: 'A checkup of your money, and answers to questions about it'
  }
];

/**
 * `/import` and the other setup pages are deliberately absent above: they live
 * under Settings (Connections, Categories, Rules), which opens from the avatar.
 * Absent from `TABS` is not the same as hidden -- `isHiddenRoute()` only
 * refuses paths under a catalogue entry. A `hiddenTabs` entry saved before v2
 * ("/budgets") matches nothing now and is dropped the next time Settings saves.
 */

/**
 * Home's cards: what can be switched on or off under the hero.
 *
 * Each one is a glance that points somewhere else -- a figure and a line, or a
 * short list -- never a copy of the page it links to. The hero (what is left of
 * the month) is not here: it is the reason Home exists.
 *
 * `on` is the product's opinion. What a person changed is stored as two lists
 * (`user_preferences.hidden_cards` for defaults they switched off,
 * `dashboard_cards` for extras they switched on), so a card added by a later
 * version arrives in its own default state instead of reading as "off" to
 * everyone who ever customized. Ids must not reuse the v1 dashboard's (tiles,
 * advisor, spending, attention, netWorth, accounts, recent): those may still
 * sit in a stored preference and would switch a card on by accident.
 */
export interface HomeCardDef {
  id: string;
  label: string;
  description: string;
  /** glance: a small tile in the main column; main: a full-width section; rail: the right column. */
  place: 'glance' | 'main' | 'rail';
  on: boolean;
}

export const HOME_CARDS: HomeCardDef[] = [
  { id: 'payday', label: 'Next payday', description: 'Date, expected pay, bills before it', place: 'glance', on: true },
  { id: 'worth', label: 'Net worth', description: 'Total and how it moved this month', place: 'glance', on: true },
  { id: 'flow', label: 'In and out', description: 'Money in and out so far', place: 'glance', on: false },
  { id: 'repeating', label: 'Recurring cost', description: 'Repeating charges as a monthly cost', place: 'glance', on: false },
  { id: 'kept', label: 'Last month', description: 'How it ended against its budget', place: 'main', on: true },
  { id: 'review', label: 'To review', description: 'New transactions to check', place: 'main', on: true },
  { id: 'budgets', label: 'Budgets', description: 'Envelopes closest to their limit', place: 'rail', on: true },
  { id: 'upcoming', label: 'Upcoming bills', description: 'The next 7 days', place: 'rail', on: true },
  { id: 'goals', label: 'Goals', description: 'Progress on active goals', place: 'rail', on: true },
  { id: 'places', label: 'Top places', description: 'Where the most went this month', place: 'rail', on: false },
  { id: 'finding', label: 'Advisor finding', description: 'One thing worth a look', place: 'rail', on: true }
];

export const HOME_CARD_IDS = HOME_CARDS.map((c) => c.id);

/** The cards switched on, from the two stored lists. */
export function homeCards(hidden: string[], added: string[] | null): Set<string> {
  return new Set(
    HOME_CARDS.filter((c) => (c.on ? !hidden.includes(c.id) : !!added?.includes(c.id))).map((c) => c.id)
  );
}

/** The inverse: the two lists to store for a set of switched-on cards. */
export function storeHomeCards(on: string[]): { hiddenCards: string[]; dashboardCards: string[] } {
  return {
    hiddenCards: HOME_CARDS.filter((c) => c.on && !on.includes(c.id)).map((c) => c.id),
    dashboardCards: HOME_CARDS.filter((c) => !c.on && on.includes(c.id)).map((c) => c.id)
  };
}

/** Hiding a tab must never hide the way back to Settings or Home. */
export function visibleTabs(hidden: string[]): TabDef[] {
  return TABS.filter((t) => t.fixed || !hidden.includes(t.href));
}

/** A route belongs to a tab when it is the tab or anything under it, so a
 *  hidden Wealth also refuses /wealth/<account>. */
export function isHiddenRoute(pathname: string, hidden: string[]): boolean {
  const tab = TABS.find(
    (t) => t.href !== '/' && (pathname === t.href || pathname.startsWith(t.href + '/'))
  );
  if (!tab || tab.fixed) return false;
  return hidden.includes(tab.href);
}
