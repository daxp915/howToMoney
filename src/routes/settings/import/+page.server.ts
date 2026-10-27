import { fail, redirect } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { accounts, importBatches } from '$lib/server/db/schema';
import { detectMapping, parseCsv } from '$lib/server/import/csv';
import { isOfx, parseOfx } from '$lib/server/import/ofx';
import { accountChoices } from '$lib/server/import/accounts';
import type { Actions, PageServerLoad } from './$types';

const MAX_BYTES = 5 * 1024 * 1024;

export const load: PageServerLoad = async ({ locals }) => {
  return {
    accountOptions: await accountChoices(locals.user?.email),
    recent: await db
      .select({
        id: importBatches.id,
        filename: importBatches.filename,
        status: importBatches.status,
        imported: importBatches.importedCount,
        duplicates: importBatches.duplicateCount,
        skipped: importBatches.skippedCount,
        createdAt: importBatches.createdAt,
        accountName: accounts.name
      })
      .from(importBatches)
      .innerJoin(accounts, eq(accounts.id, importBatches.accountId))
      .orderBy(desc(importBatches.createdAt))
      .limit(10)
  };
};

export const actions: Actions = {
  upload: async ({ request }) => {
    const form = await request.formData();
    const accountId = String(form.get('accountId') ?? '');
    const file = form.get('file');

    if (!accountId) return fail(400, { message: 'Pick the account this file belongs to.' });
    if (!(file instanceof File) || file.size === 0) return fail(400, { message: 'Choose a file.' });
    if (file.size > MAX_BYTES) {
      return fail(400, { message: `File is ${(file.size / 1e6).toFixed(1)}MB; the limit is 5MB.` });
    }

    const text = await file.text();

    // OFX/QFX carries its own field names and already signs amounts correctly,
    // so there is nothing to map -- it goes straight to preview.
    if (isOfx(text)) {
      const parsed = parseOfx(text);
      if (!parsed.rows.length) {
        return fail(400, { message: 'No <STMTTRN> transactions found in that OFX file.' });
      }

      const [batch] = await db
        .insert(importBatches)
        .values({
          accountId,
          filename: file.name,
          rawCsv: text,
          mapping: { format: 'ofx' },
          rowCount: parsed.rows.length,
          status: 'pending'
        })
        .returning({ id: importBatches.id });

      throw redirect(303, `/settings/import/${batch.id}`);
    }

    const rows = parseCsv(text);
    if (rows.length < 2) {
      return fail(400, { message: 'That file has no data rows once parsed as CSV.' });
    }

    const mapping = detectMapping(rows);
    const [batch] = await db
      .insert(importBatches)
      .values({
        accountId,
        filename: file.name,
        rawCsv: text,
        mapping,
        rowCount: mapping.hasHeader ? rows.length - 1 : rows.length,
        status: 'pending'
      })
      .returning({ id: importBatches.id });

    // Nothing is written to the ledger until the mapping is confirmed.
    throw redirect(303, `/settings/import/${batch.id}`);
  }
};
