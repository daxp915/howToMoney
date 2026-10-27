import 'dotenv/config';
import { and, eq, ne } from 'drizzle-orm';
import { db, runAsUser } from '../src/lib/server/db';
import { resolveUserArg } from './lib/whose';
import { merchants, transactions } from '../src/lib/server/db/schema';
import { normalizeDescription } from '../src/lib/server/sync/normalize';
import { matchTransfers } from '../src/lib/server/matching/transfers';
import { backfillSubscriptionFlags, categorizePending } from '../src/lib/server/ai/categorize';
import { detectRecurring } from '../src/lib/server/matching/recurring';

// Re-derives everything that is computed from stored transactions, without
// refetching from the provider. Run this after changing normalizeDescription:
// merchant keys are the join between a transaction and everything the system has
// learned, so a normalizer change leaves the whole cache pointing at the wrong
// rows until this runs.
//
// Categories set by hand are never touched.

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // Row-level security means an unscoped run would find no transactions and
  // report success having done nothing. Reprocessing is per user; with more
  // than one, name them: `npm run reprocess -- dad@example.com`.
  const user = await resolveUserArg(process.argv.find((a) => a.includes('@')));
  console.log(`reprocessing ${user.email}${dryRun ? ' (dry run)' : ''}`);
  return runAsUser(user.id, () => reprocess(dryRun));
}

async function reprocess(dryRun: boolean) {

  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      payee: transactions.payee,
      normalizedKey: transactions.normalizedKey
    })
    .from(transactions);

  let changed = 0;
  const remap = new Map<string, string>();

  for (const r of rows) {
    const next = normalizeDescription(r.payee || r.description || '');
    if (next === r.normalizedKey) continue;
    changed++;
    remap.set(r.normalizedKey, next);
    if (!dryRun) {
      await db
        .update(transactions)
        .set({ normalizedKey: next })
        .where(eq(transactions.id, r.id));
    }
  }

  console.log(`normalized keys: ${changed} of ${rows.length} transactions changed`);
  for (const [from, to] of [...remap].slice(0, 12)) console.log(`  "${from}" -> "${to}"`);
  if (remap.size > 12) console.log(`  … and ${remap.size - 12} more`);

  if (dryRun) {
    console.log('\ndry run - nothing written');
    process.exit(0);
  }

  // Merchant rows are keyed on the old normalization. Move the ones whose key
  // changed so learned categories and user pins survive; drop any that would
  // now collide with an existing row, since the survivor already has the
  // mapping.
  for (const [from, to] of remap) {
    const [existing] = await db.select().from(merchants).where(eq(merchants.normalizedKey, to));
    if (existing) {
      await db.delete(merchants).where(eq(merchants.normalizedKey, from));
    } else {
      await db
        .update(merchants)
        .set({ normalizedKey: to, updatedAt: new Date() })
        .where(eq(merchants.normalizedKey, from));
    }
  }

  // Release everything the model and cache decided so it is re-derived under the
  // new keys. User choices and transfer legs are left alone -- categorizePending
  // skips transfers, so releasing them would strand them uncategorized.
  const released = await db
    .update(transactions)
    .set({ categorySource: 'none', needsReview: false })
    .where(and(ne(transactions.categorySource, 'user'), eq(transactions.isTransfer, false)))
    .returning({ id: transactions.id });

  console.log(`released ${released.length} transactions for re-categorization`);

  const transfers = await matchTransfers(3650);
  console.log(`transfers: ${transfers.matched} matched, ${transfers.queuedForReview} queued`);

  const cat = await categorizePending(5000);
  console.log(
    `categorized: ${cat.byRule} by rule, ${cat.byMemory} from memory, ${cat.byAi} by model ` +
      `(${cat.queuedForReview} to review, $${cat.usage.costUsd.toFixed(4)})`
  );

  const back = await backfillSubscriptionFlags();
  console.log(`subscription flags: asked ${back.asked}, ${back.subscriptions} are subscriptions (${back.usage.costUsd.toFixed(4)})`);

  const rec = await detectRecurring();
  console.log(
    `recurring: ${rec.detected} confirmed, ${rec.suspected} suspected, ${rec.ended} ended, ` +
      `${rec.amountChanges} price changes`
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
