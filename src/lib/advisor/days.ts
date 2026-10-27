/**
 * Calendar days as `YYYY-MM-DD` strings, the unit every advisor calculation
 * works in. Arithmetic runs at UTC noon, so a daylight-saving change can never
 * push a day into the next or previous one.
 */

const DAY_MS = 86400000;

export function toTime(day: string): number {
  return Date.parse(day + 'T12:00:00Z');
}

export function fromTime(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return fromTime(toTime(day) + n * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS);
}

export function dayOfMonth(day: string): number {
  return Number(day.slice(8, 10));
}

export function daysInMonth(day: string): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** `day`'s month, on day-of-month `dom`, clamped to the month's last day. */
export function onDayOfMonth(day: string, dom: number): string {
  const last = daysInMonth(day);
  return `${day.slice(0, 8)}${String(Math.min(dom, last)).padStart(2, '0')}`;
}

/** The first of the month `n` months after `day`'s. */
export function monthsLater(day: string, n: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + n;
  return fromTime(Date.UTC(y, m, 1, 12));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * `n` cadences after `day`. Monthly and longer (quarterly, yearly) step by
 * whole months and keep the day of the month, clamped to short months --
 * a bill on the 31st is on the 30th in September, not drifting by 30-day
 * steps. Shorter cadences step by days.
 */
export function stepCadence(day: string, cadenceDays: number, n = 1): string {
  if (cadenceDays >= 26) {
    const months = Math.max(1, Math.round(cadenceDays / 30.44));
    return onDayOfMonth(monthsLater(day, months * n), dayOfMonth(day));
  }
  return addDays(day, cadenceDays * n);
}

/** The latest date on `last`'s schedule that is on or before `today`. */
export function rollForward(last: string, cadenceDays: number, today: string): string {
  if (cadenceDays <= 0) return last;
  let k = 0;
  while (stepCadence(last, cadenceDays, k + 1) <= today && k < 2000) k++;
  return k ? stepCadence(last, cadenceDays, k) : last;
}
