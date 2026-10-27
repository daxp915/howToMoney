/**
 * A figure the app worked out, kept apart from the sentence it appears in.
 *
 * Checkup findings and advisor answers are text with `{{id}}` placeholders
 * plus a map of figures. Two reasons, both invariants elsewhere in the app:
 *
 * - **Masking.** A number inside a string cannot be wrapped in `.amt`, so it
 *   would stay on screen when somebody presses Hide. The page renders each
 *   placeholder as its own element.
 * - **Provenance.** The model writes the placeholder, never the number, so
 *   every figure in an answer is one the app computed -- and a figure that is
 *   a sum of transactions carries the link to them, like every other one.
 */

export type FigKind = 'money' | 'percent' | 'rate' | 'months' | 'date' | 'count';

export interface Fig {
  /** Money and counts as numbers; percent as a fraction (0.14); rate as an
   *  annual percentage (6.49); date as YYYY-MM-DD. */
  value: number | string;
  kind: FigKind;
  /** What it is, for a screen reader and for the model. */
  label?: string;
  /** The rows behind it, when it is a sum of transactions. */
  href?: string | null;
  /** An amount over a limit: shown in accent-deep with "over" after it. */
  tone?: 'over';
}

export interface Templated {
  text: string;
  figures: Record<string, Fig>;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatFig(f: Fig): string {
  switch (f.kind) {
    case 'money':
      return usd.format(Number(f.value));
    case 'percent':
      return `${Math.round(Number(f.value) * 100)}%`;
    case 'rate':
      return `${Number(Number(f.value).toFixed(2))}%`;
    case 'months': {
      const v = Math.round(Number(f.value) * 10) / 10;
      return `${v} month${v === 1 ? '' : 's'}`;
    }
    case 'date':
      return new Date(String(f.value) + 'T12:00:00Z').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC'
      });
    case 'count':
      return String(f.value);
  }
}

/** Money is what the privacy toggle hides; a date or a count gives nothing away. */
export const isMasked = (f: Fig) => f.kind === 'money';

export const PLACEHOLDER = /\{\{([a-z0-9_]+)\}\}/gi;

export type Segment = { text: string } | { fig: string };

/** Text and placeholders in order, for a page to render piece by piece. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index) });
    out.push({ fig: m[1] });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The sentence with its figures written in -- for logs, the model's history,
 *  and anything that is not a page. `mask` writes money as bullets. */
export function renderPlain(t: Templated, mask = false): string {
  return t.text.replace(PLACEHOLDER, (whole, id: string) => {
    const f = t.figures[id];
    if (!f) return whole;
    return mask && isMasked(f) ? '$•••' : formatFig(f);
  });
}
