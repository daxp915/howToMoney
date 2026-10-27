import { moved } from '$lib/server/moved';
import type { PageServerLoad } from './$types';

// Bank link is Settings > Connections (v2).
export const load: PageServerLoad = ({ url }) => moved(url, '/settings/connections');
