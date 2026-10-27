import { moved } from '$lib/server/moved';
import type { PageServerLoad } from './$types';

// Goals moved to Plan (v2).
export const load: PageServerLoad = ({ url }) => moved(url, '/plan', { tab: 'goals' });
