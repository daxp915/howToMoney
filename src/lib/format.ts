const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
});

export function money(value: number | string | null | undefined): string {
  return usd.format(Number(value ?? 0));
}

export function shortDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fullDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Initials for a merchant or institution, as a stand-in for a logo. */
export function initials(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Inline style for something wearing a category's colour: a wash of it behind,
 * and the colour itself as text -- pulled toward the theme's text colour,
 * because the ramps run light as well as dark and a pale step on its own tint
 * is unreadable on cream. Mixing with `--text-primary` darkens it in the light
 * theme and lightens it in the dark one, so one rule serves both.
 */
export function tint(color: string, strength = 18): string {
  return `background:color-mix(in srgb, ${color} ${strength}%, transparent); color:color-mix(in oklab, ${color} 60%, var(--text-primary))`;
}
