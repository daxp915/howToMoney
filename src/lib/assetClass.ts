/**
 * What kind of thing a holding is, from its name.
 *
 * SimpleFIN reports a ticker and a description and nothing about what the fund
 * holds. A fund's name says it plainly often enough -- "Total International
 * Stock Index", "2060 Target Date Retirement", "Government Money Market" -- so
 * the answer is read from the name, in a fixed order where the first match
 * wins: a target-date fund holds stocks and bonds, and is its own kind rather
 * than whichever word appears first, and an international bond fund is bonds.
 * Anything unrecognised is "Other", never a guess.
 *
 * Deterministic on purpose. It would be a cheap question for the model, but the
 * answer never changes for a given fund and a wrong one would silently redraw
 * the allocation chart; a name that reads as nothing is better shown as Other.
 */
export type AssetClass = 'us' | 'intl' | 'bonds' | 'target' | 'cash' | 'other';

export const ASSET_CLASSES: Array<{ key: AssetClass; label: string }> = [
  { key: 'us', label: 'US stocks' },
  { key: 'intl', label: 'International stocks' },
  { key: 'target', label: 'Target-date funds' },
  { key: 'bonds', label: 'Bonds' },
  { key: 'cash', label: 'Cash' },
  { key: 'other', label: 'Other' }
];

const CASH_TICKERS = new Set(['SPAXX', 'FDRXX', 'FZFXX', 'SPRXX', 'VMFXX', 'VMRXX', 'SWVXX', 'CORE']);

const RULES: Array<[AssetClass, RegExp]> = [
  ['cash', /money market|cash reserves|sweep|core position|treasury money/i],
  ['target', /target|\b20[2-7]\d\b|retirement income|lifecycle|freedom index/i],
  ['bonds', /bond|treasury|fixed income|aggregate|municipal|tips|income fund/i],
  ['intl', /international|intl|ex[- ]?u\.?s|foreign|emerging|developed markets|global ex/i],
  ['us', /500|total (stock )?market|total stock|s&p|extended market|large[- ]cap|mid[- ]cap|small[- ]cap|growth|value|nasdaq|dow|russell|stock index|equity/i]
];

export function assetClass(symbol: string | null, description: string | null): AssetClass {
  if (symbol && CASH_TICKERS.has(symbol.toUpperCase())) return 'cash';
  const text = `${description ?? ''} ${symbol ?? ''}`;
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  return 'other';
}
