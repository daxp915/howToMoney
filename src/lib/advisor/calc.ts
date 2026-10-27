/**
 * Arithmetic over figures the app already computed, for the Advisor's
 * `calculate` tool. The model may not do sums in its head (every number on
 * screen must be the app's), but it can ask for one: "f3 / f14" -- the
 * savings gap over the monthly surplus -- is evaluated here, exactly, and the
 * result registered as a figure of its own.
 *
 * A tiny recursive-descent parser, not `eval`: figure ids (f12), plain
 * numbers, + - * /, unary minus and parentheses. Nothing else parses.
 */

export type Lookup = (id: string) => number | null;

export class CalcError extends Error {}

export function evaluate(expression: string, lookup: Lookup): number {
  const src = expression.replace(/\s+/g, '');
  if (!src) throw new CalcError('Empty expression.');
  if (src.length > 200) throw new CalcError('Expression too long.');
  let i = 0;

  const peek = () => src[i];
  const eat = (c: string) => {
    if (src[i] !== c) throw new CalcError(`Expected "${c}" at position ${i + 1}.`);
    i++;
  };

  function expr(): number {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  function term(): number {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = factor();
      if (op === '/') {
        if (r === 0) throw new CalcError('Division by zero.');
        v = v / r;
      } else v = v * r;
    }
    return v;
  }

  function factor(): number {
    const c = peek();
    if (c === '-') {
      i++;
      return -factor();
    }
    if (c === '(') {
      i++;
      const v = expr();
      eat(')');
      return v;
    }
    const id = /^f\d+/.exec(src.slice(i));
    if (id) {
      i += id[0].length;
      const v = lookup(id[0]);
      if (v === null || !Number.isFinite(v)) throw new CalcError(`${id[0]} is not a numeric figure from the tool results.`);
      return v;
    }
    const num = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    throw new CalcError(c === undefined ? 'Expression ends early.' : `Unexpected "${c}" at position ${i + 1}.`);
  }

  const v = expr();
  if (i !== src.length) throw new CalcError(`Unexpected "${src[i]}" at position ${i + 1}.`);
  if (!Number.isFinite(v)) throw new CalcError('The result is not a finite number.');
  return v;
}
