import { queryOptions } from '@tanstack/svelte-query';
import { unwrap, type ApiClient } from '#lib/api/client.js';
import type { ResponseBody } from '#lib/api/types.js';
import { POLL_INTERVAL_MS } from '#lib/query/client.js';

export type Capabilities = ResponseBody<'/capabilities', 'get'>;
export type NomadConnection = ResponseBody<'/integrations/nomad', 'get'>;

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
