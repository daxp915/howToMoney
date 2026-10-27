import crypto from 'node:crypto';
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { transactions } from '../db/schema';
import { normalizeDescription, toCents } from '../sync/normalize';
import type { ParsedRow } from './csv';

const DAY_MS = 24 * 60 * 60 * 1000;

// How far apart the same transaction may appear between a bank's API feed and
// its CSV export. They frequently disagree by a day or two on the post date.
const DEDUP_WINDOW_DAYS = 3;

export interface ImportResult {
  imported: number;
  duplicates: number;
  skipped: number;
  errors: string[];
  dateRange: { from: Date; to: Date } | null;
}

/**
 * A CSV import overlaps whatever the API already delivered, so the hard part is
 * not reading the file -- it is not double-counting. Two defences:
 *
 *  1. A synthesized, deterministic provider id, so re-importing the same file is
 *     a no-op regardless of everything below.
 *  2. Fuzzy matching against rows already in the account, with each existing row
 *     consumable exactly once. Consumption matters: two identical $5.75 coffees
 *     on one day are two transactions, and a set-based check would collapse them
 *     into one.
 *
 * `dryRun` runs the same matching and writes nothing: the import screen's
 * "New transactions / Already in HTMFD" counts are this function's
 * own answer, so the button's number is the number that lands.
 */
export async function commitImport(
  accountId: string,
  rows: ParsedRow[],
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    duplicates: 0,
    skipped: 0,
    errors: [],
    dateRange: null
  };

  const valid = rows.filter((r) => !r.error);
  result.skipped = rows.length - valid.length;
  for (const bad of rows.filter((r) => r.error).slice(0, 5)) {
    result.errors.push(`${bad.error} (${bad.raw.slice(0, 3).join(' | ')})`);
  }
  if (!valid.length) return result;

  const times = valid.map((r) => r.postedAt.getTime());
  const from = new Date(Math.min(...times));
  const to = new Date(Math.max(...times));
  result.dateRange = { from, to };

  const existing = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      postedAt: transactions.postedAt,
      normalizedKey: transactions.normalizedKey
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        gte(transactions.postedAt, new Date(from.getTime() - DEDUP_WINDOW_DAYS * DAY_MS)),
        lte(transactions.postedAt, new Date(to.getTime() + DEDUP_WINDOW_DAYS * DAY_MS))
      )
    );

  const pool = existing.map((e) => ({
    id: e.id,
    cents: toCents(e.amount),
    time: e.postedAt.getTime(),
    key: e.normalizedKey,
    consumed: false
  }));

  // Distinguishes repeated identical rows within one file.
  const seenInFile = new Map<string, number>();

  for (const row of valid) {
    const cents = toCents(row.amount);
    const key = normalizeDescription(row.description);
    const time = row.postedAt.getTime();

    const match = pool.find((p) => {
      if (p.consumed) return false;
      if (p.cents !== cents) return false;
      const dayGap = Math.abs(p.time - time) / DAY_MS;
      if (dayGap > DEDUP_WINDOW_DAYS) return false;
      // Same amount on the same day is conclusive enough on its own; further
      // apart, the merchant has to agree too.
      return dayGap < 1 || p.key === key;
    });

    if (match) {
      match.consumed = true;
      result.duplicates++;
      continue;
    }

    const fingerprint = `${row.postedAt.toISOString().slice(0, 10)}|${row.amount}|${key}`;
    const occurrence = seenInFile.get(fingerprint) ?? 0;
    seenInFile.set(fingerprint, occurrence + 1);
    if (dryRun) {
      result.imported++;
      continue;
    }

    const providerTxnId =
      'csv:' +
      crypto
        .createHash('sha1')
        .update(`${accountId}|${fingerprint}|${occurrence}`)
        .digest('hex')
        .slice(0, 24);

    await db
      .insert(transactions)
      .values({
        accountId,
        provider: 'csv',
        providerTxnId,
        postedAt: row.postedAt,
        amount: row.amount,
        description: row.description,
        normalizedKey: key,
        pending: false,
        raw: { source: 'csv', columns: row.raw }
      })
      .onConflictDoNothing({
        target: [transactions.userId, transactions.provider, transactions.providerTxnId]
      });

    result.imported++;
  }

  return result;
}
