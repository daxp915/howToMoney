import { readFile } from 'node:fs/promises';
import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** The email icons from `workers/feedback/public/email/`, so /dev/email shows them before the Worker serves them. */
export const GET: RequestHandler = async ({ params }) => {
  if (!dev || !/^[a-z-]+\.png$/.test(params.file)) error(404, 'Not found');
  try {
    const png = await readFile(`workers/feedback/public/email/${params.file}`);
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  } catch {
    error(404, 'Not found');
  }
};
