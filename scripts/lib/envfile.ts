import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal .env reader/writer that preserves comments, ordering and formatting.
// Deliberately never logs a value: these helpers only ever handle secrets.

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(here, '..', '..', '.env');

export function envPath(): string {
  return ENV_PATH;
}

export function exists(): boolean {
  return fs.existsSync(ENV_PATH);
}

export function readAll(): Map<string, string> {
  const out = new Map<string, string>();
  if (!exists()) return out;

  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    // Strip an inline comment, but only when the value is unquoted.
    let value = m[2].trim();
    if (!/^['"]/.test(value)) value = value.replace(/\s+#.*$/, '').trim();
    else value = value.replace(/^(['"])(.*)\1$/, '$2');
    out.set(m[1], value);
  }
  return out;
}

export function get(key: string): string {
  return readAll().get(key) ?? '';
}

/** Set or replace a key in place, keeping the rest of the file untouched. */
export function set(key: string, value: string): void {
  const lines = exists() ? fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/) : [];
  const pattern = new RegExp(`^\\s*${key}\\s*=`);

  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      lines[i] = `${key}=${value}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) lines.push(`${key}=${value}`);

  fs.writeFileSync(ENV_PATH, lines.join('\n'), { mode: 0o600 });
}

/** Report presence without revealing anything about the value. */
export function describe(key: string): string {
  const v = get(key);
  return v ? `set (${v.length} chars)` : 'MISSING';
}
