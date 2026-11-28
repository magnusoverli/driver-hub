import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// The device list moved to the home page; old links and bookmarks keep their filters.
export const load: PageLoad = ({ url }) => {
	redirect(308, `${resolve('/(app)')}${url.search}`);
};
