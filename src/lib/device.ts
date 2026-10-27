/**
 * A session's browser, in the words the Security page lists it by:
 * "iPhone · Safari", "Mac · Firefox". Deliberately coarse -- enough to answer
 * "is that one mine?", not a fingerprint.
 */
export function describeDevice(ua: string | null | undefined): { name: string; initials: string } {
  if (!ua) return { name: 'Unknown device', initials: '?' };

  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;

  // Order matters: Edge and Chrome both say "Chrome", and every iOS browser
  // says "Safari".
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua)
      ? 'Firefox'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;

  const name = [device, browser].filter(Boolean).join(' · ') || 'Unknown device';
  const initials = device
    ? device.startsWith('iP')
      ? 'iP'
      : device.charAt(0)
    : (browser?.charAt(0) ?? '?');
  return { name, initials };
}

/** "Now", "Last active 5 minutes ago", "... 2 days ago", "... 3 weeks ago". */
export function lastActive(at: Date, now = new Date()): string {
  const mins = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (mins < 10) return 'Now';
  const ago = (n: number, unit: string) => `Last active ${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (mins < 60) return ago(mins, 'minute');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return ago(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 14) return ago(days, 'day');
  return ago(Math.floor(days / 7), 'week');
}
