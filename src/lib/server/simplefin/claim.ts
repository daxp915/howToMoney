import { claimSetupToken, fetchAccounts } from './client';
import { saveSimpleFinAccessUrl } from './credentials';
import { startFirstSyncReview } from '../review';

/**
 * Claim a pasted setup token, prove the connection reads accounts, and store
 * it. Setup (`/welcome`) and Connections share this so a rejected token reads
 * the same in both places.
 *
 * The failure is classified rather than passed through: "Claim failed: 403
 * Forbidden" is what a person sees when they paste a token twice, and the
 * only useful answer to it is "make a new one" with the link.
 */
export type ClaimResult =
  | { ok: true; accounts: string[] }
  | { ok: false; message: string; newToken: boolean };

export async function claimToken(raw: string, label: string): Promise<ClaimResult> {
  const token = raw.trim();
  if (!token) return { ok: false, message: 'Paste the setup token from SimpleFIN first.', newToken: false };

  let accessUrl: string;
  try {
    accessUrl = await claimSetupToken(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    console.warn('[simplefin] claim failed:', msg);
    if (/did not decode/.test(msg))
      return {
        ok: false,
        message: "That doesn't look like a setup token. Copy it again from SimpleFIN, or",
        newToken: true
      };
    if (/^Claim failed: (403|404|410)/.test(msg))
      return { ok: false, message: 'This token has already been used. Each one works once, so', newToken: true };
    if (/^Claim failed/.test(msg))
      return { ok: false, message: 'SimpleFIN refused this token. Try again, or', newToken: true };
    return { ok: false, message: "SimpleFIN didn't answer. Try again in a minute.", newToken: false };
  }

  // Prove it works before storing it: balances only, so nothing is pulled.
  let accounts: string[];
  try {
    const probe = await fetchAccounts(accessUrl, { balancesOnly: true });
    accounts = probe.accounts.map((a) => `${a.org?.name ?? 'Your bank'} · ${a.name}`);
  } catch (e) {
    console.warn('[simplefin] probe after claim failed:', e instanceof Error ? e.message : e);
    return {
      ok: false,
      message: "SimpleFIN accepted the token but couldn't read your accounts. Try again in a minute, or",
      newToken: true
    };
  }

  await saveSimpleFinAccessUrl(accessUrl, label);
  // Its first sync lands everything unreviewed; Activity offers a way out.
  await startFirstSyncReview();
  return { ok: true, accounts };
}
