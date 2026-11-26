import { describe, expect, it } from 'vitest';
import { statusPath, type DeploymentSummary } from './status-path.js';

const base: DeploymentSummary = {
	nodeId: '11111111-1111-4111-8111-111111111111',
	driverId: 'meter',
	version: '1.0.0',
	label: null,
	status: 'running',
	revision: 3,
	requiresOriginalStopped: false,
	requested: 'running',
	communication: 'unknown',
	communicationEvidence: { state: 'unknown', reason: 'no_control_check' },
	approval: 'unknown',
	allocation: { id: 'a', desired: 'run', status: 'running' }
};

describe('status path', () => {
	it('never claims control from a running allocation alone, nor approval at all', () => {
		expect(statusPath(base)).toEqual({
			requested: 'verified',
			allocation: 'verified',
			control: 'unknown',
			approval: 'unknown'
		});
	});

	it('shows verified control only from a fresh driver report', () => {
		expect(statusPath({ ...base, communication: 'driver-reports-connected' }).control).toBe(
			'verified'
		);
		expect(statusPath({ ...base, communication: 'check-failed' }).control).toBe('failed');
	});

	it('shows an unplaced or failed allocation', () => {
		expect(statusPath({ ...base, allocation: null }).allocation).toBe('pending');
		expect(
			statusPath({ ...base, allocation: { id: 'a', desired: 'run', status: 'pending' } }).allocation
		).toBe('pending');
		expect(
			statusPath({ ...base, allocation: { id: 'a', desired: 'run', status: 'failed' } }).allocation
		).toBe('failed');
		expect(
			statusPath({ ...base, allocation: { id: 'a', desired: 'run', status: 'lost' } }).allocation
		).toBe('failed');
	});

	it('marks a stopped deployment as not requested', () => {
		expect(statusPath({ ...base, requested: 'stopped', allocation: null })).toEqual({
			requested: 'inactive',
			allocation: 'inactive',
			control: 'inactive',
			approval: 'unknown'
		});
	});

	it('claims nothing when Nomad could not report the deployment', () => {
		const path = statusPath({
			...base,
			requested: null,
			communication: 'driver-reports-connected'
		});
		expect(Object.values(path)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
	});
});
