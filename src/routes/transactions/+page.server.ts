import { fail } from '@sveltejs/kit';
import {
  accountOptions,
  feed,
  monthBars,
  monthSummary,
  pickerCategories,
  readFilters,
  reviewCount,
  setCategory,
  whereItWent,
  setHidden,
  setNote,
  split,
  unsplit,
  type SplitPart
} from '$lib/server/activity';
import { endFirstSyncReview, firstSyncReview, markAllReviewed, markReviewed, markUnreviewed, UUID } from '$lib/server/review';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { recurringSeries, transactions } from '$lib/server/db/schema';
import { markRecurring } from '$lib/server/recurringUser';
import { drillHref } from '$lib/drill';
import type { Actions, PageServerLoad } from './$types';

/**
 * Activity: money in and out by month above, every transaction
 * below, newest first and grouped by day. The URL carries the filters and
 * the drill-down from any figure in the app (category, merchant, account,
 * flow, settled, from/to) exactly as before, so every figure's link still
 * lands on the rows that sum to it.
 */
const PERIODS = { '1m': 1, '6m': 6, ytd: 0, '1y': 12, all: 24 } as const;
type Period = keyof typeof PERIODS;
const PAGE = 60;

export const load: PageServerLoad = async ({ url, locals }) => {
  const f = readFilters(url);
  const asked = url.searchParams.get('p') as Period | null;
  const period: Period = asked && asked in PERIODS ? asked : '6m';
  const months = period === 'ytd' ? new Date().getMonth() + 1 : PERIODS[period];
  const limit = Math.min(Math.max(Number(url.searchParams.get('n')) || PAGE, PAGE), 2000);

  const filtered =
    !!f.q || f.account.length > 0 || !!f.category || !!f.merchant || !!f.from || !!f.to || !!f.flow || f.settled || f.review;

  const [bars, list, toReview, cats, accts, firstSync] = await Promise.all([
    monthBars(Math.max(months, 1)),
    feed(f, limit),
    reviewCount(),
    pickerCategories(),
    accountOptions(locals.user?.email ?? null),
    firstSyncReview()
  ]);

  // The hero and "Where it went" cover the whole period, or one month once a
  // bar is tapped; tapping it again goes back to the period.
  const picked = bars.find((b) => b.month === url.searchParams.get('m')) ?? null;
  const first = bars[0];
  const last = bars[bars.length - 1];
  const win = picked ? { from: picked.from, to: picked.to } : { from: first.from, to: last.to };
  const prev = previousWindow(win.from, picked ? 1 : bars.length, win.to);
  const income = picked ? picked.income : bars.reduce((s, b) => s + b.income, 0);
  const spending = picked ? picked.spending : bars.reduce((s, b) => s + b.spending, 0);
  const hero = {
    month: picked?.month ?? '',
    label: rangeLabel(win.from, win.to, true),
    income,
    spending,
    inHref: drillHref({ ...win, flow: 'in' }),
    outHref: drillHref({ ...win, flow: 'out' })
  };
  const went = await whereItWent(win, prev);
  const wentNote = went.since
    ? `since ${new Date(went.since + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : went.compared
      ? `vs ${prev.partial ? partialLabel(prev.from, prev.to) : rangeLabel(prev.from, prev.to, false)}`
      : null;

  // Month-in-review cards where the plain feed crosses into an earlier month.
  const thisMonth = bars[bars.length - 1]?.month;
  const crossed = filtered
    ? []
    : [...new Set(list.rows.map((r) => r.postedAt.slice(0, 7)))].filter((m) => m !== thisMonth).slice(0, 3);
  const summaries = await Promise.all(crossed.map((m) => monthSummary(m)));

  // An empty list means "nothing in this window" -- unless there is nothing
  // anywhere yet, when "try a longer period" sends a new account hunting.
  const noHistory =
    list.rows.length === 0 &&
    (await db.select({ id: transactions.id }).from(transactions).limit(1)).length === 0;

  return {
    filters: f,
    noHistory,
    filtered,
    period,
    limit,
    bars,
    hero,
    went: { ...went, month: picked ? hero.label : null, note: wentNote, outHref: hero.outHref },
    rows: list.rows,
    more: list.more,
    total: list.total,
    sum: list.sum,
    toReview,
    firstSync,
    summaries,
    categories: cats,
    accounts: accts
  };
};

/**
 * The window of `months` months before `from`. While the current window is
 * still running it is cut to as many days as have passed: three weeks of
 * October against all of September reads as every category falling.
 */
function previousWindow(from: string, months: number, to: string) {
  const [y, m] = from.split('-').map(Number);
  const iso = (d: Date) => d.toLocaleDateString('en-CA');
  const start = new Date(y, m - 1 - months, 1);
  const end = new Date(y, m - 1, 0);
  const today = iso(new Date());
  if (to > today) {
    const elapsed = Math.round((new Date(today + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / 864e5);
    const cut = new Date(start.getFullYear(), start.getMonth(), start.getDate() + elapsed);
    if (cut < end) return { from: iso(start), to: iso(cut), partial: true };
  }
  return { from: iso(start), to: iso(end), partial: false };
}

/**
 * "September", "Apr – Sep" (the hero) or "Oct–Mar" (the comparison note);
 * years only when the two ends are in different ones.
 */
function rangeLabel(from: string, to: string, hero: boolean) {
  const a = new Date(from + 'T12:00:00');
  const b = new Date(to + 'T12:00:00');
  const same = a.getFullYear() === b.getFullYear();
  if (same && a.getMonth() === b.getMonth()) return a.toLocaleDateString('en-US', { month: hero ? 'long' : 'short' });
  const fmt = (d: Date) => d.toLocaleDateString('en-US', same ? { month: 'short' } : { month: 'short', year: 'numeric' });
  return hero ? `${fmt(a)} – ${fmt(b)}` : `${fmt(a)}–${fmt(b)}`;
}

/** "Sep 1–23", or "Apr 1–Sep 23" across months: a window cut short. */
function partialLabel(from: string, to: string) {
  const a = new Date(from + 'T12:00:00');
  const b = new Date(to + 'T12:00:00');
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${md(a)}–${b.getDate()}`
    : `${md(a)}–${md(b)}`;
}

const id = (form: FormData) => String(form.get('id') ?? '');

const RECENT_DAYS = 14;

export const actions: Actions = {
  /** "Review just the last 2 weeks": older rows are marked done. */
  reviewRecent: async () => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - RECENT_DAYS);
    const n = await markAllReviewed(since);
    await endFirstSyncReview();
    return { reviewedAll: n };
  },
  /** "Mark all N reviewed", and the overflow menu's "Mark all reviewed". */
  reviewAll: async () => {
    const n = await markAllReviewed();
    await endFirstSyncReview();
    return { reviewedAll: n };
  },
  category: async ({ request }) => {
    const form = await request.formData();
    await setCategory(id(form), String(form.get('categoryId') ?? ''), form.get('always') === 'on');
    return { ok: true };
  },
  // The old page's action name, kept for anything still posting it.
  setCategory: async ({ request }) => {
    const form = await request.formData();
    await setCategory(String(form.get('txnId') ?? ''), String(form.get('categoryId') ?? ''), false);
    return { ok: true };
  },
  review: async ({ request }) => {
    const form = await request.formData();
    const ids = form.getAll('id').map(String);
    if (form.get('undo') === '1') await markUnreviewed(ids[0] ?? '');
    else await markReviewed(ids);
    return { ok: true };
  },
  note: async ({ request }) => {
    const form = await request.formData();
    await setNote(id(form), String(form.get('note') ?? ''));
    return { ok: true };
  },
  hide: async ({ request }) => {
    const form = await request.formData();
    await setHidden(id(form), form.get('hidden') === '1');
    return { ok: true };
  },
  split: async ({ request }) => {
    const form = await request.formData();
    let parts: SplitPart[] = [];
    try {
      parts = JSON.parse(String(form.get('parts') ?? '[]'));
    } catch {
      return fail(400, { message: 'Could not read the parts.' });
    }
    const err = await split(id(form), parts);
    if (err) return fail(400, { message: err });
    return { ok: true, split: parts.length };
  },
  unsplit: async ({ request }) => {
    const form = await request.formData();
    await unsplit(id(form));
    return { ok: true };
  },
  /** "Mark as recurring" at a cadence, or stop counting the series (`off`). */
  recurring: async ({ request }) => {
    const form = await request.formData();
    const seriesId = String(form.get('series') ?? '');
    if (form.get('off') === '1') {
      if (!UUID.test(seriesId)) return fail(400, { message: 'Bad request.' });
      await db
        .update(recurringSeries)
        .set({ status: 'ignored', updatedAt: new Date() })
        .where(eq(recurringSeries.id, seriesId));
      return { ok: true };
    }
    const err = await markRecurring(id(form), Number(form.get('cadence')));
    if (err) return fail(400, { message: err });
    return { ok: true };
  }
};
