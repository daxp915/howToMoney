import { moved } from '$lib/server/moved';
import type { PageServerLoad } from './$types';

// Import moved under Settings > Connections (v2).
export const load: PageServerLoad = ({ url }) => moved(url, '/settings/import');
