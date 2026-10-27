/**
 * SimpleFIN's account names, made readable.
 *
 * The provider hands back whatever the bank calls the account, which is
 * usually shouting (`MAPLE EVERYDAY CHECKING (4821)`), often repeats the last
 * four digits (`Checking - 7788 (7788)`), and for some cards is only the
 * cardholder's first name (`Alex (3021)`). The Bank link page lists every
 * account as a cleaned name over "Institution · last4", so the digits come out
 * of the name and into their own slot.
 *
 * A nickname the user set always wins; none of this rewrites what is stored.
 */

const ACRONYMS = new Set(['TD', 'IRA', 'HSA', 'CD', 'HV', 'US', 'USA', 'FSA', 'LLC', 'UK']);
const GENERIC = new Set(['checking', 'savings', 'credit card', 'card', 'loan', 'brokerage']);

const DIGITS = /\s*(?:\((\d{4})\)|-\s*(\d{4}))\s*$/;

/** The last four digits the provider put in the name, if it did. */
export function lastFour(name: string): string | null {
  let rest = name;
  let found: string | null = null;
  // Some names carry them twice: `Checking - 7788 (7788)`.
  for (let m = DIGITS.exec(rest); m; m = DIGITS.exec(rest)) {
    found ??= m[1] ?? m[2];
    rest = rest.slice(0, m.index);
  }
  return found;
}

function stripDigits(name: string): string {
  let rest = name;
  for (let m = DIGITS.exec(rest); m; m = DIGITS.exec(rest)) rest = rest.slice(0, m.index);
  return rest.trim();
}

/** Title case for a name that arrived in capitals; mixed case is left alone. */
function unshout(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s
    .split(/\s+/)
    .map((w) => {
      if (ACRONYMS.has(w)) return w;
      if (/^\d+\(K\)$/.test(w)) return w.replace('(K)', '(k)');
      if (/\d/.test(w)) return w;
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** "Discover Credit Card" -> "Discover", "Maple Bank (US)" -> "Maple Bank". */
export function institutionName(org: string | null): string {
  if (!org) return '';
  let s = org.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  s = s.replace(/\s+(Credit Card|Bank Account|Account|Investments)$/i, '');
  // "Chase Bank" -> "Chase", but "TD Bank" stays: "TD" alone reads as a typo.
  const bare = s.replace(/\s+Bank$/i, '');
  if (bare !== s && bare.length > 3) s = bare;
  return s;
}

/**
 * The name to show. `holder` is the signed-in person's email, whose local part
 * is how a card named after its cardholder gets recognised.
 */
export function accountDisplayName(
  a: { name: string; nickname: string | null; orgName: string | null },
  holder?: string | null
): string {
  if (a.nickname?.trim()) return a.nickname.trim();

  const name = unshout(stripDigits(a.name));
  const org = a.orgName?.replace(/\s*\([^)]*\)\s*/g, ' ').trim() ?? '';

  // A card named only for its holder: the institution's own name describes it
  // better. "Discover Credit Card" reads as "Discover Card".
  const local = holder?.split('@')[0].replace(/[^a-z]/gi, '').toLowerCase() ?? '';
  const word = name.toLowerCase();
  if (org && !/\s/.test(name) && word.length >= 3 && local.startsWith(word)) {
    return org.replace(/\s+Credit Card$/i, ' Card').replace(/\s+Account$/i, '');
  }

  // "Checking" alone says nothing about whose; lead with the institution.
  if (GENERIC.has(word) && org) return `${institutionName(org)} ${name}`;

  return name || a.name;
}
