// Turning a raw bank descriptor into a stable cache key is the single highest
// leverage function in the app: every layer downstream (merchant memory, rule
// matching, AI batching) keys off it. Over-normalizing merges distinct
// merchants; under-normalizing sends the same merchant to the LLM forever.

const PROCESSOR_PREFIXES = [
  'google *',
  'google*',
  'sq *',
  'sq*',
  'tst*',
  'tst *',
  'py *',
  'pp*',
  'paypal *',
  'paypal*',
  'sp *',
  'sp*',
  'wl *',
  'in *',
  'dd *',
  'ab *',
  'chk*',
  'pos ',
  'pos debit ',
  'debit card purchase ',
  'card purchase ',
  'recurring payment ',
  'purchase authorized on ',
  'ach debit ',
  'ach credit ',
  'external withdrawal ',
  'external deposit '
];

// Trailing noise banks append: store numbers, auth codes, dates, phone numbers.
const NOISE_PATTERNS: RegExp[] = [
  /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, // dates
  /\b[a-z]{2}\s*\d{5,}\b/g, // state + store number
  /\b\d{3}[- ]?\d{3}[- ]?\d{4}\b/g, // phone numbers
  /\bx{2,}\d+\b/g, // masked card digits
  /#\s*\d+/g, // #1234
  /\b\d{6,}\b/g, // long numeric ids
  /\b(auth|ref|id|inv|trace|conf)[#:\s-]*[a-z0-9]{4,}\b/g
];

// Two-letter state codes commonly trailing US descriptors.
const TRAILING_STATE = /\s+(a[klrz]|c[aot]|de|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy])$/;

export function normalizeDescription(raw: string): string {
  let s = (raw || '').toLowerCase().trim();

  for (const prefix of PROCESSOR_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }

  for (const re of NOISE_PATTERNS) s = s.replace(re, ' ');

  s = s
    .replace(/[^a-z0-9&' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Wallet suffixes, stripped BEFORE the trailing-state rule. Discover appends
  // "GOOGLE PAY" with no separator, so a descriptor arrives as
  // "...CHELMSFORD MAGOOGLE PAY ENDING IN 1234" with the state code fused to the
  // wallet name. Deliberately no word boundary before the wallet name --
  // "magoogle" has to match. Everything after it is wallet metadata, never
  // merchant identity. Removing it first is what lets the state code become
  // trailing again so the next rule can take it.
  s = s.replace(/(google|apple|samsung|paypal)\s*pay\b.*$/, ' ');
  s = s.replace(/\bending in\b.*$/, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  s = s.replace(TRAILING_STATE, '');

  // Collapse obvious location suffixes ("starbucks store seattle" -> "starbucks store").
  s = s.replace(/\s+(store|stor|str)$/, '');

  // A bare 3-6 digit token is a store or reference number wherever it appears,
  // not part of a merchant name -- "market basket 0088 lowell" and the same
  // chain's other branch have to land on one key or every location becomes its
  // own merchant, and its own question for the model. Shorter runs are left
  // alone because they are real names: 7 Eleven, 99 Ranch, Studio 54.
  s = s.replace(/\b\d{3,6}\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  return s.trim() || (raw || '').toLowerCase().trim();
}

// Display fallback before the AI layer has produced a clean name.
export function titleCase(s: string): string {
  return s
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

// SimpleFIN gives amounts as decimal strings. Never parse money into a float
// for storage -- only for comparison, and only at cent granularity.
export function toCents(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
