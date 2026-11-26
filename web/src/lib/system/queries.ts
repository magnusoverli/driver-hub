import { queryOptions } from '@tanstack/svelte-query';
import { unwrap, type ApiClient } from '#lib/api/client.js';
import type { paths } from '#lib/api/schema.js';
import { POLL_INTERVAL_MS } from '#lib/query/client.js';

type Json<T> = T extends { content: { 'application/json': infer Body } } ? Body : never;

export type Capabilities = Json<paths['/capabilities']['get']['responses'][200]>;
export type NomadConnection = Json<paths['/integrations/nomad']['get']['responses'][200]>;

export const systemKeys = {
	all: ['system'] as const,
	capabilities: () => [...systemKeys.all, 'capabilities'] as const,
	nomad: () => [...systemKeys.all, 'nomad'] as const
};

export function capabilitiesQuery(api: ApiClient) {
	return queryOptions({
		queryKey: systemKeys.capabilities(),
		queryFn: () => unwrap(api.GET('/capabilities')),
		refetchInterval: POLL_INTERVAL_MS
	});
}

export function nomadConnectionQuery(api: ApiClient) {
	return queryOptions({
		queryKey: systemKeys.nomad(),
		queryFn: () => unwrap(api.GET('/integrations/nomad')),
		refetchInterval: POLL_INTERVAL_MS
	});
}
