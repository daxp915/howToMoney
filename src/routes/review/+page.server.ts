import { moved } from '$lib/server/moved';
import type { PageServerLoad } from './$types';

// Review is a filter in Activity now (v2); Home carries the inbox.
export const load: PageServerLoad = ({ url }) => moved(url, '/transactions', { review: '1' });
