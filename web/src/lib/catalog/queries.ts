import { queryOptions } from '@tanstack/svelte-query';
import { unwrap, type ApiClient } from '#lib/api/client.js';
import type { ResponseBody } from '#lib/api/types.js';

export type RetainedRelease = ResponseBody<'/retained', 'get'>['releases'][number];

export const catalogKeys = {
	all: ['catalog'] as const,
	retained: () => [...catalogKeys.all, 'retained'] as const
};

/** Releases downloaded to this manager, including customer builds. Read from local disk. */
export function retainedQuery(api: ApiClient) {
	return queryOptions({
		queryKey: catalogKeys.retained(),
		queryFn: async () => (await unwrap(api.GET('/retained'))).releases,
		staleTime: 30_000
	});
}
