import { moved } from '$lib/server/moved';
import type { PageServerLoad } from './$types';

// Rules moved under Settings (v2).
export const load: PageServerLoad = ({ url }) => moved(url, '/settings/rules');
