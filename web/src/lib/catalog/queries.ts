import { queryOptions } from '@tanstack/svelte-query';
import { unwrap, type ApiClient } from '#lib/api/client.js';
import { ApiError } from '#lib/api/errors.js';
import type { ResponseBody, Schema } from '#lib/api/types.js';
import type { operations } from '#lib/api/schema.js';

export type RetainedRelease = ResponseBody<'/retained', 'get'>['releases'][number];
export type Identity = Pick<RetainedRelease, 'driverId' | 'version'>;
export type Collection = 'published' | 'retained';
export type ImportMetadata = NonNullable<
	operations['importLocalRelease']['requestBody']['content']['multipart/form-data']['metadata']
>;

export function importRelease(
	api: ApiClient,
	path: Identity,
	metadata: ImportMetadata,
	image: File,
	signal: AbortSignal
) {
	return unwrap(
		api.PUT('/imports/{driverId}/{version}', {
			params: { path },
			signal,
			// The generated binary field is typed as a string. The serializer sends the original
			// File as binary, without reading a potentially multi-GiB archive into JS memory.
			body: { metadata, image: image.name },
			bodySerializer: (body) => {
				const parts = new FormData();
				if (body.metadata && Object.keys(body.metadata).length)
					parts.append('metadata', JSON.stringify(body.metadata));
				parts.append('image', image);
				return parts;
			}
		})
	);
}
export type BuildInput = {
	driverId: string;
	commit: string;
	directory: string;
	platform: string;
	configuration?: Schema<'Declaration'>;
};

export const catalogKeys = {
	all: ['catalog'] as const,
	retained: () => [...catalogKeys.all, 'retained'] as const
};

export function publishedQuery(api: ApiClient, prerelease: boolean) {
	return queryOptions({
		queryKey: [...catalogKeys.all, 'published', prerelease],
		queryFn: async () =>
			(await unwrap(api.GET('/releases', { params: { query: { prerelease } } }))).releases,
		staleTime: 5 * 60_000,
		refetchOnWindowFocus: false
	});
}

export function releaseQuery(
	api: ApiClient,
	collection: Collection,
	{ driverId, version }: Identity
) {
	return queryOptions({
		queryKey: [...catalogKeys.all, 'detail', collection, driverId, version],
		queryFn: () =>
			unwrap(
				api.GET(
					collection === 'published'
						? '/releases/{driverId}/{version}'
						: '/retained/{driverId}/{version}',
					{
						params: { path: { driverId, version } }
					}
				)
			)
	});
}

export function acquireRelease(api: ApiClient, input: Identity | BuildInput, key?: string) {
	const header = key ? { Prefer: 'respond-async' as const, 'Idempotency-Key': key } : undefined;
	return 'commit' in input
		? unwrap(api.POST('/builds', { params: { header }, body: input }))
		: unwrap(
				api.PUT('/retained/{driverId}/{version}', {
					params: { path: { driverId: input.driverId, version: input.version }, header }
				})
			);
}

/** Releases downloaded to this manager, including customer builds. Read from local disk. */
export function retainedQuery(api: ApiClient) {
	return queryOptions({
		queryKey: catalogKeys.retained(),
		queryFn: async () => (await unwrap(api.GET('/retained'))).releases,
		staleTime: 30_000
	});
}

export type ReleaseUse = { nodeId: string; use: 'current' | 'previous' | 'unconfirmed' };

/** Removes a retained release and its verified image, unless a deployment still needs it. */
export function removeRelease(api: ApiClient, { driverId, version }: Identity) {
	return unwrap(
		api.DELETE('/retained/{driverId}/{version}', { params: { path: { driverId, version } } })
	);
}

/** The deployments a refused removal names: those running the release or keeping it to roll back. */
export function releaseUses(error: unknown): ReleaseUse[] {
	if (!(error instanceof ApiError) || error.code !== 'release_in_use') return [];
	const uses = error.details?.deployments;
	return Array.isArray(uses) ? (uses as ReleaseUse[]) : [];
}
