import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// The manager settings are now part of Settings → Advanced.
export const load: PageLoad = () => {
	redirect(308, resolve('/(app)/settings/advanced'));
};
