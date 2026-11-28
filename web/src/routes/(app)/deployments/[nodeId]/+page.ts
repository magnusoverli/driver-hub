import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Device pages moved from /deployments to /devices.
export const load: PageLoad = ({ params }) => {
	redirect(308, resolve('/(app)/devices/[nodeId]', { nodeId: params.nodeId }));
};
