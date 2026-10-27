import crypto from 'node:crypto';

/**
 * Authenticated encryption for provider credentials held in the database.
 *
 * The threat this answers is a stolen database dump, not a stolen host. The key
 * lives in `.env` and the ciphertext lives in Postgres, so a backup that walks
 * out on its own — the thing that actually gets copied to other machines — is
 * useless without the key, and the key is useless without the rows. Anyone with
 * root on the box has both, which is why the sudo-docker grant matters more
 * than this does.
 *
 * AES-256-GCM: the tag is what makes a tampered ciphertext fail loudly instead
 * of decrypting to garbage that some later parser might trust.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The version prefix
 * exists so the algorithm can change later without guessing at old rows.
 */

const VERSION = 'v1';
const IV_BYTES = 12; // GCM's standard nonce length
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY ?? '';
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Run `npm run setup` to generate one, or copy it from the .env ' +
        'that encrypted the existing rows -- without it stored credentials cannot be read.'
    );
  }

  // base64url is what `npm run setup` writes; plain base64 and hex are accepted
  // so a key pasted from elsewhere still works.
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64url');

  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY decodes to ${buf.length} bytes; AES-256 needs ${KEY_BYTES}. ` +
        'Generate one with `npm run setup`.'
    );
  }

  cachedKey = buf;
  return buf;
}

/** Test seam: forces the next call to re-read the environment. */
export function resetKeyCache(): void {
  cachedKey = null;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(
    '.'
  );
}

export function decryptSecret(encoded: string): string {
  const [version, ivPart, tagPart, ctPart] = encoded.split('.');
  if (version !== VERSION || !ivPart || !tagPart || !ctPart) {
    throw new Error('Stored credential is not in the expected v1 format.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(ivPart, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ctPart, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    // Wrong key or edited ciphertext. Both mean the same thing operationally:
    // do not proceed with whatever this was supposed to authenticate.
    throw new Error(
      'Stored credential failed authentication — either ENCRYPTION_KEY changed or the row was altered.'
    );
  }
}
