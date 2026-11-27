import { queryOptions } from '@tanstack/svelte-query';
import { unwrap, type ApiClient } from '#lib/api/client.js';
import type { Schema } from '#lib/api/types.js';
import { m } from '#lib/paraglide/messages.js';
import type { Tone } from '#lib/ui/Badge.svelte';

export type Operation = Schema<'Operation'>;
export type OperationState = Operation['state'];

/** While something runs, its outcome is checked often; otherwise new work is picked up slowly. */
export const ACTIVE_POLL_MS = 1_500;

export const operationKeys = {
	all: ['operations'] as const,
	list: () => [...operationKeys.all, 'list'] as const
};

/**
 * The manager's most recent background downloads and builds, newest first. Polled quickly only
 * while one runs; pass `idlePollMs` to also notice work that someone else starts.
 */
export function operationsQuery(api: ApiClient, idlePollMs: number | false = false) {
	return queryOptions({
		queryKey: operationKeys.list(),
		queryFn: async () => (await unwrap(api.GET('/operations'))).operations,
		refetchInterval: (query) =>
			query.state.data?.some((operation) => operation.state === 'running')
				? ACTIVE_POLL_MS
				: idlePollMs
	});
}

export const OPERATION_FILTERS = ['all', 'running', 'problems', 'succeeded'] as const;
export type OperationFilter = (typeof OPERATION_FILTERS)[number];

/** Problems are failures and interruptions: both need someone to look at them. */
export function matchesOperationFilter(operation: Operation, filter: OperationFilter): boolean {
	switch (filter) {
		case 'running':
			return operation.state === 'running';
		case 'problems':
			return operation.state === 'failed' || operation.state === 'interrupted';
		case 'succeeded':
			return operation.state === 'succeeded';
		default:
			return true;
	}
}

export function operationKind(operation: Operation): string {
	return operation.kind === 'build' ? m.operation_kind_build() : m.operation_kind_retain();
}

const stateLabels: Record<OperationState, () => string> = {
	running: m.operation_state_running,
	succeeded: m.operation_state_succeeded,
	failed: m.operation_state_failed,
	interrupted: m.operation_state_interrupted
};

export function operationStateLabel(state: OperationState): string {
	return stateLabels[state]();
}

/** Completed reads as a plain fact: a stored release says nothing about any running driver. */
export const operationStateTones: Record<OperationState, Tone> = {
	running: 'accent',
	succeeded: 'neutral',
	failed: 'fail',
	interrupted: 'warn'
};

/** What the operation works on: a published version, or a source revision to build. */
export function operationSubject(operation: Operation): { driver: string; detail: string } {
	const driver = operation.release?.driverId ?? operation.target?.driverId ?? m.operation_unknown();
	if (operation.kind === 'build') {
		const commit = operation.target?.commit;
		return {
			driver,
			detail: commit ? m.operation_build_commit({ commit: commit.slice(0, 12) }) : ''
		};
	}
	return { driver, detail: operation.release?.version ?? operation.target?.version ?? '' };
}

/** How long it ran, or has been running so far. */
export function operationDuration(operation: Operation, now: number): number {
	const started = Date.parse(operation.startedAt);
	const finished = operation.finishedAt ? Date.parse(operation.finishedAt) : now;
	return Math.max(0, finished - started);
}
