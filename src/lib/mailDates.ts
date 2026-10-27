/**
 * Dates as the emails say them, in one time zone (the household's, not the
 * server's: the NAS and the Cloudflare Worker both run in UTC). Pure, shared
 * by `$lib/alertPlan` and `$lib/relayMails`.
 */

export const MAIL_TZ = 'America/New_York';
const DAY = 864e5;

export function mailDates(tz = MAIL_TZ) {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o });
  const dayF = f({ month: 'short', day: 'numeric' });
  const timeF = f({ hour: 'numeric', minute: '2-digit' });
  const zoneF = f({ hour: 'numeric', timeZoneName: 'short' });
  const longF = f({ weekday: 'long', month: 'short', day: 'numeric' });
  const keyF = f({ year: 'numeric', month: '2-digit', day: '2-digit' });
  const wdF = f({ weekday: 'short' });
  const SHORT: Record<string, string> = { Sun: 'Su', Mon: 'M', Tue: 'Tu', Wed: 'W', Thu: 'Th', Fri: 'F', Sat: 'Sa' };

  /** Calendar day in the zone, sortable: "2026-10-05". */
  const key = (d: Date) => {
    const p = Object.fromEntries(keyF.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };

  const api = {
    /** "Oct 5" */
    day: (d: Date) => dayF.format(d),
    /** "6:02 AM" */
    time: (d: Date) => timeF.format(d),
    /** "EDT" */
    zone: (d: Date) => zoneF.formatToParts(d).find((x) => x.type === 'timeZoneName')?.value ?? '',
    /** "Sunday, Oct 4 at 6:02 AM" */
    long: (d: Date) => `${longF.format(d)} at ${timeF.format(d)}`,
    /** "Oct 7, 2:14 PM" */
    stamp: (d: Date) => `${dayF.format(d)}, ${timeF.format(d)}`,
    /** "today, 9:12 AM" or "Oct 5, 9:12 AM" */
    when: (d: Date, now: Date) => `${key(d) === key(now) ? 'today' : dayF.format(d)}, ${timeF.format(d)}`,
    key,
    /** The last `n` calendar days ending today, oldest first, with strip labels ("Th", …, "Today"). */
    days(now: Date, n = 7): { key: string; label: string }[] {
      return Array.from({ length: n }, (_, i) => {
        const d = new Date(now.getTime() - (n - 1 - i) * DAY);
        return { key: key(d), label: i === n - 1 ? 'Today' : SHORT[wdF.format(d)] ?? wdF.format(d) };
      });
    }
  };
  return api;
}

/** "2 days", "1 day", "5 hours", "1 hour" -- the hero figure for a duration. */
export function duration(ms: number): string {
  const days = Math.floor(ms / DAY);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.max(1, Math.round(ms / 36e5));
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
