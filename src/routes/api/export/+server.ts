import { error } from '@sveltejs/kit';
import { exportData, transactionsCsv } from '$lib/server/accountData';
import type { RequestHandler } from './$types';

/**
 * Downloads the signed-in household's data.
 *   GET /api/export            everything, JSON
 *   GET /api/export?format=csv transactions, CSV
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) throw error(401, 'Not authenticated');
  const day = new Date().toISOString().slice(0, 10);
  const headers = (type: string, name: string) => ({
    'content-type': type,
    'content-disposition': `attachment; filename="${name}"`,
    'cache-control': 'no-store'
  });

  if (url.searchParams.get('format') === 'csv') {
    return new Response(await transactionsCsv(), {
      headers: headers('text/csv; charset=utf-8', `howtomoney-transactions-${day}.csv`)
    });
  }
  return new Response(JSON.stringify(await exportData(locals.user.email), null, 2), {
    headers: headers('application/json; charset=utf-8', `howtomoney-export-${day}.json`)
  });
};
