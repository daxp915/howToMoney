/**
 * Which chip a category wears: spending on accent-100, income on sage-100, and
 * everything that is not spending at all on the neutral track colour.
 *
 * `group` carries income and transfer. The other three neutral categories are
 * filed under `expense` in the taxonomy -- they are money out of an account --
 * but none of them is spending in the sense the chip colour means: Cash & ATM
 * is money changing form, Fees & Interest is administrative (it already takes
 * the neutral ramp in taxonomy.ts), and Uncategorized is not a category yet.
 * The handoff names exactly these four as neutral.
 */
const NEUTRAL_NAMES = new Set(['Cash & ATM', 'Fees & Interest', 'Uncategorized']);

export type ChipTone = 'spend' | 'income' | 'neutral';

export function categoryTone(group: string | null | undefined, name: string | null | undefined): ChipTone {
  if (group === 'income') return 'income';
  if (group === 'transfer') return 'neutral';
  if (name && NEUTRAL_NAMES.has(name)) return 'neutral';
  return 'spend';
}
