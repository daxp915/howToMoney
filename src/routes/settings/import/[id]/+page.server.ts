import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts, importBatches } from '$lib/server/db/schema';
import { mapRows, parseCsv, type ColumnMapping, type ParsedRow } from '$lib/server/import/csv';
import { accountChoices } from '$lib/server/import/accounts';
import { parseOfx } from '$lib/server/import/ofx';
import { commitImport } from '$lib/server/import/commit';
import { matchTransfers } from '$lib/server/matching/transfers';
import { categorizePending } from '$lib/server/ai/categorize';
import { detectRecurring } from '$lib/server/matching/recurring';
import type { Actions, PageServerLoad } from './$types';

const PREVIEW_ROWS = 8;

async function loadBatch(id: string) {
  const [batch] = await db
    .select({
      id: importBatches.id,
      accountId: importBatches.accountId,
      filename: importBatches.filename,
      rawCsv: importBatches.rawCsv,
      mapping: importBatches.mapping,
      status: importBatches.status,
      imported: importBatches.importedCount,
      duplicates: importBatches.duplicateCount,
      skipped: importBatches.skippedCount,
      accountName: accounts.name
    })
    .from(importBatches)
    .innerJoin(accounts, eq(accounts.id, importBatches.accountId))
    .where(eq(importBatches.id, id));

  if (!batch) throw error(404, 'Import not found');
  return batch;
}

function mappingFromForm(form: FormData, fallback: ColumnMapping): ColumnMapping {
  const num = (k: string, d: number) => {
    const v = form.get(k);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    dateColumn: num('dateColumn', fallback.dateColumn),
    descriptionColumn: num('descriptionColumn', fallback.descriptionColumn),
    amountColumn: num('amountColumn', fallback.amountColumn),
    debitColumn: num('debitColumn', fallback.debitColumn),
    creditColumn: num('creditColumn', fallback.creditColumn),
    dateOrder: (form.get('dateOrder') as ColumnMapping['dateOrder']) ?? fallback.dateOrder,
    invertAmount: form.get('invertAmount') === 'on',
    hasHeader: form.get('hasHeader') === 'on'
  };
}

function isOfxBatch(mapping: unknown): boolean {
  return !!mapping && typeof mapping === 'object' && (mapping as { format?: string }).format === 'ofx';
}

/**
 * What the Import button would do, from the same matching it runs:
 * new rows, rows already in HTMFD, and the dates the file covers.
 */
async function summarize(batch: Awaited<ReturnType<typeof loadBatch>>, rows: ParsedRow[]) {
  const committed = batch.status === 'committed';
  const dry = committed ? null : await commitImport(batch.accountId, rows, { dryRun: true });
  return {
    bytes: Buffer.byteLength(batch.rawCsv),
    fresh: dry?.imported ?? batch.imported ?? 0,
    duplicates: dry?.duplicates ?? batch.duplicates ?? 0,
    unreadable: rows.filter((r) => r.error).length,
    from: dry?.dateRange?.from ?? null,
    to: dry?.dateRange?.to ?? null
  };
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const batch = await loadBatch(params.id);
  const accountOptions = await accountChoices(locals.user?.email);

  if (isOfxBatch(batch.mapping)) {
    const parsed = parseOfx(batch.rawCsv);
    return {
      summary: await summarize(batch, parsed.rows),
      accountOptions,
      batch: { ...batch, rawCsv: undefined },
      format: 'ofx' as const,
      ofxAccount: parsed.account,
      headers: [],
      mapping: null,
      preview: parsed.rows.slice(0, PREVIEW_ROWS),
      totals: {
        rows: parsed.rows.length,
        readable: parsed.rows.filter((r) => !r.error).length,
        unreadable: parsed.rows.filter((r) => r.error).length
      },
      sampleRaw: parsed.rows.slice(0, PREVIEW_ROWS).map((r) => r.raw)
    };
  }

  const rows = parseCsv(batch.rawCsv);
  const mapping = batch.mapping as ColumnMapping;

  const headers = mapping.hasHeader
    ? rows[0]
    : rows[0].map((_, i) => `Column ${i + 1}`);

  const allMapped = mapRows(rows, mapping);
  const preview = allMapped.slice(0, PREVIEW_ROWS);

  return {
    summary: await summarize(batch, allMapped),
    accountOptions,
    batch: { ...batch, rawCsv: undefined },
    format: 'csv' as const,
    ofxAccount: null,
    headers,
    mapping,
    preview,
    totals: {
      rows: allMapped.length,
      readable: allMapped.filter((r) => !r.error).length,
      unreadable: allMapped.filter((r) => r.error).length
    },
    sampleRaw: rows.slice(mapping.hasHeader ? 1 : 0, (mapping.hasHeader ? 1 : 0) + PREVIEW_ROWS)
  };
};

export const actions: Actions = {
  // Re-parse with a corrected mapping and show the result. Still writes nothing.
  preview: async ({ params, request }) => {
    const batch = await loadBatch(params.id);
    if (batch.status === 'committed') return fail(400, { message: 'Already imported.' });

    const mapping = mappingFromForm(await request.formData(), batch.mapping as ColumnMapping);
    await db.update(importBatches).set({ mapping }).where(eq(importBatches.id, params.id));
    return { success: true };
  },

  /** "Into account": the file goes somewhere else; the counts follow. */
  account: async ({ params, request }) => {
    const batch = await loadBatch(params.id);
    if (batch.status === 'committed') return fail(400, { message: 'Already imported.' });
    const accountId = String((await request.formData()).get('accountId') ?? '');
    // Row-level security already limits this to the person's own accounts.
    const [own] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId));
    if (!own) return fail(400, { message: 'Pick one of your accounts.' });
    await db.update(importBatches).set({ accountId }).where(eq(importBatches.id, params.id));
    return { success: true };
  },

  // The columns are saved by `preview` as they change, so the import uses the
  // stored mapping: the button sits outside the column form.
  commit: async ({ params }) => {
    const batch = await loadBatch(params.id);
    if (batch.status === 'committed') {
      return fail(400, { message: 'This file has already been imported.' });
    }

    const ofx = isOfxBatch(batch.mapping);
    const mapping = batch.mapping as ColumnMapping;
    const rows = ofx ? parseOfx(batch.rawCsv).rows : mapRows(parseCsv(batch.rawCsv), mapping);
    const result = await commitImport(batch.accountId, rows);

    await db
      .update(importBatches)
      .set({
        mapping,
        status: 'committed',
        importedCount: result.imported,
        duplicateCount: result.duplicates,
        skippedCount: result.skipped
      })
      .where(eq(importBatches.id, params.id));

    // Imported rows go through exactly the same pipeline as synced ones.
    const transfers = await matchTransfers(3650);
    const categorized = await categorizePending();
    // Older history is exactly what turns a two-occurrence guess into a
    // confirmed series, so re-scan after every import.
    await detectRecurring();

    return {
      success: true,
      imported: result.imported,
      duplicates: result.duplicates,
      skipped: result.skipped,
      errors: result.errors,
      transfersMatched: transfers.matched,
      categorized: categorized.byRule + categorized.byMemory + categorized.byAi,
      aiCost: categorized.usage.costUsd
    };
  }
};
