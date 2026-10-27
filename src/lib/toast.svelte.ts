/**
 * One dark toast at a time ("Split into 2 · Gifts budget updated", Undo).
 * v2 uses a toast with Undo instead of a confirmation dialog for anything
 * fully reversible.
 */
interface Toast {
  id: number;
  text: string;
  undo?: () => void | Promise<void>;
}

let current = $state<Toast | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

export const toast = {
  get current() {
    return current;
  },
  show(text: string, undo?: Toast['undo'], ms = 6000) {
    clearTimeout(timer);
    current = { id: ++seq, text, undo };
    timer = setTimeout(() => (current = null), ms);
  },
  dismiss() {
    clearTimeout(timer);
    current = null;
  }
};
