import type { components } from '#lib/api/schema.js';

export type DeploymentSummary = components['schemas']['DeploymentSummary'];

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

const failedClientStates = new Set(['failed', 'lost']);

/**
 * Derives the status path from what the manager reports. A running allocation is not shown as
 * control, and approval lives in VideoIPath, so Hub never reports it as verified.
 */
export function statusPath(deployment: DeploymentSummary): StatusPath {
	const { requested, allocation, communication } = deployment;
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
