// Tests for credential encryption. Pure -- no database, no network, safe to run
// anywhere. The key is set here rather than read from .env so the test never
// depends on a deployment's configuration.
import crypto from 'node:crypto';
import { decryptSecret, encryptSecret, resetKeyCache } from '../src/lib/server/crypto';

let failures = 0;
function check(name: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!pass) failures++;
}

function withKey(key: string, fn: () => void) {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = key;
  resetKeyCache();
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
    resetKeyCache();
  }
}

const KEY_A = crypto.randomBytes(32).toString('base64url');
const KEY_B = crypto.randomBytes(32).toString('base64url');
const SECRET = 'https://user:pa55@bridge.simplefin.org/simplefin/accounts';

// ---- round trip -----------------------------------------------------------
withKey(KEY_A, () => {
  const encrypted = encryptSecret(SECRET);
  check('round trips', decryptSecret(encrypted) === SECRET);
  check('ciphertext does not contain the plaintext', !encrypted.includes('pa55'), encrypted);
  check('is versioned', encrypted.startsWith('v1.'), encrypted.slice(0, 3));

  // A fresh IV per call, so the same secret never encrypts to the same string.
  check('two encryptions differ', encryptSecret(SECRET) !== encryptSecret(SECRET));
});

// ---- authentication -------------------------------------------------------
withKey(KEY_A, () => {
  const encrypted = encryptSecret(SECRET);
  const [v, iv, tag, ct] = encrypted.split('.');

  // Flip one byte of ciphertext. GCM must reject it rather than return garbage.
  const bytes = Buffer.from(ct, 'base64url');
  bytes[0] ^= 0xff;
  let rejected = false;
  try {
    decryptSecret([v, iv, tag, bytes.toString('base64url')].join('.'));
  } catch {
    rejected = true;
  }
  check('rejects tampered ciphertext', rejected);

  let badFormat = false;
  try {
    decryptSecret('not-even-close');
  } catch {
    badFormat = true;
  }
  check('rejects malformed input', badFormat);
});

// The wrong key must fail loudly, not decrypt to nonsense that later code trusts.
{
  let encrypted = '';
  withKey(KEY_A, () => {
    encrypted = encryptSecret(SECRET);
  });
  withKey(KEY_B, () => {
    let rejected = false;
    try {
      decryptSecret(encrypted);
    } catch {
      rejected = true;
    }
    check('rejects the wrong key', rejected);
  });
}

// ---- key handling ---------------------------------------------------------
withKey(Buffer.from(KEY_A, 'base64url').toString('hex'), () => {
  check('accepts a hex key', decryptSecret(encryptSecret(SECRET)) === SECRET);
});

withKey('too-short', () => {
  let rejected = false;
  try {
    encryptSecret(SECRET);
  } catch {
    rejected = true;
  }
  check('rejects a short key', rejected);
});

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
