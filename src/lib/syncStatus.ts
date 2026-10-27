/**
 * A sync run's status in words. The column holds machine values --
 * `completed_with_errors` -- which used to be printed on the page as they
 * were, underscores and all.
 */
const WORDS: Record<string, string> = {
  running: 'in progress',
  completed: 'all accounts answered',
  completed_with_errors: 'some accounts had errors',
  failed: 'failed'
};

export function syncStatusText(status: string | null | undefined): string {
  return (status && WORDS[status]) ?? status ?? '';
}

/**
 * How a stored bank credential was set up. The one label the app writes itself
 * used to name the environment variable it came from, which means nothing to
 * anyone reading the page; older rows still carry it.
 */
export function credentialSourceText(label: string | null | undefined): string | null {
  if (!label) return null;
  if (label === 'imported from SIMPLEFIN_ACCESS_URL') return "set up from the server's settings";
  return label;
}
