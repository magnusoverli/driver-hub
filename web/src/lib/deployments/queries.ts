import { queryOptions } from '@tanstack/svelte-query';
import { unwrap, type ApiClient } from '#lib/api/client.js';
import type { ResponseBody, Schema } from '#lib/api/types.js';
import { POLL_INTERVAL_MS } from '#lib/query/client.js';

export type DeploymentSummary = Schema<'DeploymentSummary'>;
export type Deployment = Schema<'Deployment'>;
export type Allocation = Deployment['allocations'][number];
export type CommunicationEvidence = Deployment['communicationEvidence'];
export type HistoryEntry = ResponseBody<'/deployments/{nodeId}/history', 'get'>['history'][number];
export type Evaluation = ResponseBody<
	'/deployments/{nodeId}/evaluations',
	'get'
>['evaluations'][number];
export type PlacementFailure = Evaluation['placementFailures'][number];
export type UpdateSuggestion = ResponseBody<'/updates', 'get'>['updates'][number];

/** History and evaluations change only when someone acts, so they are polled less often. */
const DIAGNOSTICS_POLL_MS = 30_000;

export const deploymentKeys = {
	all: ['deployments'] as const,
	list: () => [...deploymentKeys.all, 'list'] as const,
	device: (nodeId: string) => [...deploymentKeys.all, 'device', nodeId] as const,
	detail: (nodeId: string) => [...deploymentKeys.device(nodeId), 'detail'] as const,
	history: (nodeId: string) => [...deploymentKeys.device(nodeId), 'history'] as const,
	evaluations: (nodeId: string) => [...deploymentKeys.device(nodeId), 'evaluations'] as const,
	updates: () => [...deploymentKeys.all, 'updates'] as const
};

export function deploymentsQuery(api: ApiClient) {
	return queryOptions({
		queryKey: deploymentKeys.list(),
		queryFn: async () => (await unwrap(api.GET('/deployments'))).deployments,
		refetchInterval: POLL_INTERVAL_MS
	});
}

export function deploymentQuery(api: ApiClient, nodeId: string) {
	return queryOptions({
		queryKey: deploymentKeys.detail(nodeId),
		queryFn: () => unwrap(api.GET('/deployments/{nodeId}', { params: { path: { nodeId } } })),
		refetchInterval: POLL_INTERVAL_MS
	});
}

export function historyQuery(api: ApiClient, nodeId: string) {
	return queryOptions({
		queryKey: deploymentKeys.history(nodeId),
		queryFn: async () =>
			(await unwrap(api.GET('/deployments/{nodeId}/history', { params: { path: { nodeId } } })))
				.history,
		refetchInterval: DIAGNOSTICS_POLL_MS
	});
}

export function evaluationsQuery(api: ApiClient, nodeId: string) {
	return queryOptions({
		queryKey: deploymentKeys.evaluations(nodeId),
		queryFn: async () =>
			(await unwrap(api.GET('/deployments/{nodeId}/evaluations', { params: { path: { nodeId } } })))
				.evaluations,
		refetchInterval: DIAGNOSTICS_POLL_MS
	});
}

/**
 * Newer published versions per device. Each check asks GitHub, which rate-limits anonymous
 * clients, so suggestions are kept for a few minutes and never polled.
 */
export function updatesQuery(api: ApiClient) {
	return queryOptions({
		queryKey: deploymentKeys.updates(),
		queryFn: async () => (await unwrap(api.GET('/updates'))).updates,
		staleTime: 5 * 60_000,
		refetchOnWindowFocus: false
	});
}
