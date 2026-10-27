/**
 * Plaid Link in the browser: the pop-up where a person picks their bank and
 * signs in there. Their bank password goes to Plaid, never to this server.
 *
 * The script is loaded on the first click, not with the page, so nobody who
 * never connects a bank downloads it. `svelte.config.js` allows
 * cdn.plaid.com in `script-src` and `frame-src` for exactly this.
 */

const SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

interface LinkHandler {
  open(): void;
  destroy(): void;
}
interface PlaidGlobal {
  create(config: {
    token: string;
    onSuccess: (publicToken: string, metadata: { institution: { institution_id: string; name: string } | null }) => void;
    onExit: (err: { error_message?: string; display_message?: string } | null) => void;
  }): LinkHandler;
}

let loading: Promise<PlaidGlobal> | null = null;

function loadScript(): Promise<PlaidGlobal> {
  const w = window as unknown as { Plaid?: PlaidGlobal };
  if (w.Plaid) return Promise.resolve(w.Plaid);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (w.Plaid ? resolve(w.Plaid) : reject(new Error('Plaid did not load.')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load Plaid. Check your connection and try again.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {
      /* plain text */
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * Opens Link. Resolves `true` when a bank was connected (or signed in again,
 * with `itemId`), `false` when the person closed it. The caller syncs after
 * `true`.
 */
export async function openPlaidLink(itemId?: string): Promise<boolean> {
  const [Plaid, { linkToken }] = await Promise.all([
    loadScript(),
    post<{ linkToken: string }>('/api/plaid/link-token', itemId ? { itemId } : {})
  ]);

  return new Promise((resolve, reject) => {
    const handler = Plaid.create({
      token: linkToken,
      onSuccess: (publicToken, metadata) => {
        const done = itemId
          ? post('/api/plaid/relinked', { itemId })
          : post('/api/plaid/exchange', { publicToken, institution: metadata.institution });
        done.then(() => resolve(true), reject).finally(() => handler.destroy());
      },
      onExit: (err) => {
        handler.destroy();
        if (err) reject(new Error(err.display_message || err.error_message || 'Plaid closed with an error.'));
        else resolve(false);
      }
    });
    handler.open();
  });
}
