import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as env from './lib/envfile';

// Generates the secrets that have no reason to be typed by a human, wires up
// DATABASE_URL, and reports what is still missing -- by name only, never by
// value. Safe to re-run: anything already set is left alone.

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.resolve(here, '..', '.env.example');

function randomSecret(bytes = 32): string {
  // base64url: no '/', '+' or '=' to escape inside a connection string.
  return crypto.randomBytes(bytes).toString('base64url');
}

function main() {
  if (!env.exists()) {
    fs.copyFileSync(EXAMPLE, env.envPath());
    fs.chmodSync(env.envPath(), 0o600);
    console.log('created .env from .env.example');
  }

  const generated: string[] = [];

  if (!env.get('POSTGRES_PASSWORD')) {
    env.set('POSTGRES_PASSWORD', randomSecret(24));
    generated.push('POSTGRES_PASSWORD');
  }
  if (!env.get('ENCRYPTION_KEY')) {
    env.set('ENCRYPTION_KEY', randomSecret(32));
    generated.push('ENCRYPTION_KEY');
  }

  // `--host localhost` rewrites the URL for running npm scripts on the host
  // machine; the default targets the `db` service inside the Docker network.
  const hostFlag = process.argv.indexOf('--host');
  const dbHost = hostFlag !== -1 ? (process.argv[hostFlag + 1] ?? 'localhost') : 'db';
  // Inside the Docker network it is always 5432; on the host it follows
  // DB_PORT, which docker compose reads from the same .env for the binding.
  const dbPort = dbHost === 'db' ? '5432' : env.get('DB_PORT') || process.env.DB_PORT || '5432';

  const user = env.get('POSTGRES_USER') || 'howtomoney';
  const name = env.get('POSTGRES_DB') || 'howtomoney';
  const pass = env.get('POSTGRES_PASSWORD');
  env.set('DATABASE_URL', `postgres://${user}:${encodeURIComponent(pass)}@${dbHost}:${dbPort}/${name}`);

  if (generated.length) console.log(`generated: ${generated.join(', ')}`);
  console.log(`DATABASE_URL points at ${dbHost}:${dbPort}`);

  console.log('\nSecret status (values are never printed):');
  const required: Array<[string, string]> = [
    ['POSTGRES_PASSWORD', 'generated'],
    ['ENCRYPTION_KEY', 'generated'],
    ['SIMPLEFIN_SETUP_TOKEN', 'paste from the SimpleFIN Bridge UI, then run npm run simplefin:claim'],
    ['SIMPLEFIN_ACCESS_URL', 'filled in by npm run simplefin:claim'],
    ['ANTHROPIC_API_KEY', 'console.anthropic.com -- optional, AI_PROVIDER=none works without it'],
    ['SEED_EMAIL', 'your login email'],
    ['SEED_PASSWORD', 'your login password']
  ];

  for (const [key, hint] of required) {
    const status = env.describe(key);
    console.log(`  ${key.padEnd(24)} ${status}${status === 'MISSING' ? `  <- ${hint}` : ''}`);
  }

  const claimed = !!env.get('SIMPLEFIN_ACCESS_URL');
  const token = !!env.get('SIMPLEFIN_SETUP_TOKEN');
  if (!claimed && !token) {
    console.log('\nNext: paste SIMPLEFIN_SETUP_TOKEN into .env, then `npm run simplefin:claim`.');
  } else if (!claimed) {
    console.log('\nNext: `npm run simplefin:claim`');
  } else {
    console.log('\nSimpleFIN is connected.');
  }
}

main();
