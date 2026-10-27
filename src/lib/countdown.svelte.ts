/**
 * A live "try again in N" countdown for a throttled form.
 *
 * `source` returns the seconds the server said to wait; each new value (a new
 * form response) restarts the count. It ticks down to zero and stops, which is
 * what re-enables the button -- the server stays the judge of whether the next
 * attempt is actually allowed.
 */
export function useCountdown(source: () => number) {
  let left = $state(0);

  $effect(() => {
    const start = source();
    left = start;
    if (start <= 0) return;
    const ends = Date.now() + start * 1000;
    const timer = setInterval(() => {
      left = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      if (left === 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  });

  return {
    get left() {
      return left;
    },
    get label() {
      return left < 60 ? `${left}s` : `${Math.ceil(left / 60)} min`;
    }
  };
}
