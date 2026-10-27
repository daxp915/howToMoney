/**
 * One-time tips (v2 replaces permanent explanatory text with these). The
 * server's list of dismissed ids arrives with the layout data; this adds the
 * ones put away since, so "Got it" hides a tip at once and for good.
 */
let local = $state<string[]>([]);

export const tips = {
  dismissed(id: string, server: string[] | undefined): boolean {
    return local.includes(id) || !!server?.includes(id);
  },
  async dismiss(id: string) {
    if (!local.includes(id)) local = [...local, id];
    try {
      await fetch('/api/tips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
    } catch {
      // Hidden for this visit either way; it will ask again next time.
    }
  }
};
