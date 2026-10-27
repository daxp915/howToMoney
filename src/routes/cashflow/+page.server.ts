import { moved } from '$lib/server/moved';
import type { PageServerLoad } from './$types';

// Cash flow is Activity's hero now (v2).
export const load: PageServerLoad = ({ url }) => moved(url, '/transactions');
