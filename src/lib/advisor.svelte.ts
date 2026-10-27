/**
 * The Advisor as a layer: one panel (desktop) / sheet (phone)
 * opened from anywhere -- the ask bar, ⌘K / Ctrl K, the phone's Ask button, or any
 * link to /advisor?q=... -- carrying the screen it was opened from.
 */
let open = $state(false);
let question = $state('');
let autoSend = $state(false);
let seq = $state(0);

export const advisor = {
  get open() {
    return open;
  },
  get question() {
    return question;
  },
  get autoSend() {
    return autoSend;
  },
  /** Changes every time the panel is asked to start over with a question. */
  get seq() {
    return seq;
  },
  show(q = '', send = false) {
    question = q;
    autoSend = send && !!q.trim();
    seq++;
    open = true;
  },
  hide() {
    open = false;
  },
  toggle() {
    if (open) open = false;
    else advisor.show();
  }
};
