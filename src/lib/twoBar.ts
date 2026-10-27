// Shaped by cashFlowSankey() on the server. Declared here rather than
// imported, because $lib/server must never reach the client bundle.
export interface SankeyNode {
  id: string;
  label: string;
  value: number;
  column: 0 | 1 | 2;
  color: string | null;
  icon: string | null;
}

/**
 * Two bars on one scale -- what came in, and what went out -- drawn from the
 * same nodes as the ribbon diagram, so the phone card (1c) and the desktop
 * Cash flow summary (3a) are the same arithmetic as each other and as the
 * figures printed beside them.
 *
 * The larger total is the full width. A shortfall is the out bar running past
 * a dashed line where income ends; money left over is the in bar running past
 * the end of spending, the gap filled sage.
 *
 * "From savings" (the deficit node) is not part of the in bar: it is not money
 * that came in, it is the gap itself, and putting it in the in bar would make
 * the two bars the same length and the gap disappear.
 */

export const OUT_RAMP = [
  'var(--color-out-1)',
  'var(--color-out-2)',
  'var(--color-out-3)',
  'var(--color-out-4)',
  'var(--color-out-5)'
];
export const OUT_MORE = 'var(--color-out-more)';

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface TwoBar {
  sources: SankeyNode[];
  cameIn: number;
  fromSavings: number;
  wentOut: number;
  kept: number;
  /** Width of the in bar, and the position of the dashed marker, in %. */
  inPct: number;
  short: boolean;
  /** Five categories by size, then everything else as "N more". */
  segments: Segment[];
}

export function twoBar(nodes: SankeyNode[]): TwoBar {
  const sources = nodes.filter((n) => n.column === 0 && n.id !== 'deficit');
  const fromSavings = nodes.find((n) => n.id === 'deficit')?.value ?? 0;
  const outNodes = nodes.filter((n) => n.column === 2 && n.id !== 'saved');
  const kept = nodes.find((n) => n.id === 'saved')?.value ?? 0;
  const cameIn = sources.reduce((t, n) => t + n.value, 0);
  const wentOut = outNodes.reduce((t, n) => t + n.value, 0);
  const scaleMax = Math.max(cameIn, wentOut, 1);

  // The server has already folded its own tail into "Other (N)", so that N is
  // counted too.
  const folded = (n: SankeyNode) => Number(/\((\d+)\)$/.exec(n.label)?.[1] ?? 0);
  const real = outNodes.filter((n) => !folded(n) || n.icon);
  const other = outNodes.filter((n) => folded(n) && !n.icon);
  const sorted = [...real].sort((a, b) => b.value - a.value);
  const tail = [...sorted.slice(OUT_RAMP.length), ...other];
  const segments: Segment[] = sorted.slice(0, OUT_RAMP.length).map((n, i) => ({
    key: n.id,
    label: (n.icon ? n.icon + ' ' : '') + n.label,
    value: n.value,
    color: OUT_RAMP[i]
  }));
  if (tail.length) {
    const count = tail.reduce((t, n) => t + (folded(n) && !n.icon ? folded(n) : 1), 0);
    segments.push({
      key: 'more',
      label: `${count} more`,
      value: tail.reduce((t, n) => t + n.value, 0),
      color: OUT_MORE
    });
  }

  return {
    sources,
    cameIn,
    fromSavings,
    wentOut,
    kept,
    inPct: (cameIn / scaleMax) * 100,
    short: wentOut > cameIn,
    segments
  };
}

export const pctOf = (v: number, of: number) => (of > 0 ? Math.round((v / of) * 100) : 0);
