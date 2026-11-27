import type { Allocation, Deployment, DeploymentSummary } from './queries';

export type { DeploymentSummary };

/** The four facts between "Hub asked for it" and "the device is in service", in order. */
export const HOPS = ['requested', 'allocation', 'control', 'approval'] as const;
export type Hop = (typeof HOPS)[number];

export type HopState =
	/** Hub has evidence that this step holds right now. */
	| 'verified'
	| 'failed'
	/** Expected and in progress, such as an allocation Nomad has not placed yet. */
	| 'pending'
	/** Hub has no current evidence either way. Never shown as success. */
	| 'unknown'
	/** Not requested, for example because the deployment is stopped. */
	| 'inactive';

export type StatusPath = Record<Hop, HopState>;

/** A cached observation expires even when a subsequent poll fails. */
export const OBSERVATION_TTL_MS = 30_000;
export function freshStatus<T extends Pick<Deployment, 'communication' | 'communicationEvidence'>>(
	input: T,
	now: number
): T {
	if (input.communication === 'unknown') return input;
	const age = now - Date.parse(input.communicationEvidence.observedAt ?? '');
	if (age >= 0 && age < OBSERVATION_TTL_MS) return input;
	return {
		...input,
		communication: 'unknown',
		communicationEvidence: { state: 'unknown', reason: 'stale_observation' }
	};
}

/** What the status path is derived from, as both the list and the detail report it. */
export type StatusInput = Pick<DeploymentSummary, 'requested' | 'allocation' | 'communication'>;

const failedClientStates = new Set(['failed', 'lost']);

/**
 * Derives the status path from what the manager reports. A running allocation is not shown as
 * control, and approval lives in VideoIPath, so Hub never reports it as verified.
 */
export function statusPath({ requested, allocation, communication }: StatusInput): StatusPath {
	const approval: HopState = 'unknown';
	if (requested === null) {
		return { requested: 'unknown', allocation: 'unknown', control: 'unknown', approval };
	}
	if (requested === 'stopped') {
		return { requested: 'inactive', allocation: 'inactive', control: 'inactive', approval };
	}
	const allocationState: HopState =
		allocation?.status === 'running'
			? 'verified'
			: allocation && failedClientStates.has(allocation.status)
				? 'failed'
				: 'pending';
	const control: HopState =
		communication === 'driver-reports-connected'
			? 'verified'
			: communication === 'check-failed'
				? 'failed'
				: 'unknown';
	return { requested: 'verified', allocation: allocationState, control, approval };
}

/**
 * The allocation an operator means by "where it runs", chosen as the manager does for the list:
 * the one Nomad wants running for the newest job version.
 */
export function currentAllocation(allocations: readonly Allocation[]): Allocation | null {
	let current: Allocation | null = null;
	for (const allocation of allocations) {
		if (allocation.desired !== 'run') continue;
		if (!current || (allocation.jobVersion ?? 0) > (current.jobVersion ?? 0)) current = allocation;
	}
	return current;
}

/** The detail view reports every allocation; the status path needs the current one. */
export function detailStatusInput(deployment: Deployment): StatusInput {
	return {
		requested: deployment.requested,
		communication: deployment.communication,
		allocation: currentAllocation(deployment.allocations)
	};
}
