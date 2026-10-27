import { getContext, setContext } from 'svelte';
import type { Fig } from '$lib/advisor/figures';

/**
 * Opening a figure in place. An answer provides this; a Figure
 * inside it with rows behind it becomes a toggle instead of a link to
 * Activity, and the answer draws the rows under the block the figure sits
 * in ("prose", "tiles", "shape"). Outside an answer -- a checkup finding --
 * there is no context and a figure stays a link.
 */
export type Zone = 'prose' | 'tiles' | 'shape';

export interface FigureOpener {
  isOpen(fig: Fig): boolean;
  toggle(fig: Fig, zone: Zone): void;
}

const KEY = Symbol('advisor-figure-open');

export const provideOpener = (o: FigureOpener) => setContext(KEY, o);
export const useOpener = () => getContext<FigureOpener | undefined>(KEY);
