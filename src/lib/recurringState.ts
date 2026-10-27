/**
 * Is a recurring charge still recurring? One rule, used by detection, the
 * refresh of series the person marked, `bills()` and every screen.
 *
 * A charge is expected one cadence after the last one. Past that by more than
 * the grace (billing dates slide over weekends and short months; feeds run a
 * day or two behind) it is **missed** -- shown as "may have stopped", still in
 * the forecasts, because a late charge is common. A second cadence missed
 * means it **stopped**: the series ends, leaves the monthly total and every
 * forecast, and comes back by itself if the merchant charges again.
 *
 * A bill added by hand has no charges to miss, so it is never judged here.
 */
import { addDays, stepCadence } from './advisor/days';

export type SeriesState = 'ok' | 'missed' | 'stopped';

/** A quarter of the cadence, at least 3 days, at most 30. */
export function graceDays(cadenceDays: number): number {
  return Math.min(30, Math.max(3, Math.round(cadenceDays * 0.25)));
}

export function seriesState(
  lastSeen: string,
  cadenceDays: number,
  today: string
): { state: SeriesState; expected: string } {
  const expected = stepCadence(lastSeen, cadenceDays);
  const grace = graceDays(cadenceDays);
  if (today <= addDays(expected, grace)) return { state: 'ok', expected };
  if (today <= addDays(stepCadence(lastSeen, cadenceDays, 2), grace)) return { state: 'missed', expected };
  return { state: 'stopped', expected };
}
