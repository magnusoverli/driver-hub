import { describe, expect, it } from 'vitest';
import {
	currentAllocation,
	detailStatusInput,
	freshStatus,
	statusPath,
	type DeploymentSummary
} from './status-path.js';

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
	it('expires cached success and failure without a successful refresh', () => {
		const now = Date.now();
		for (const communication of ['driver-reports-connected', 'check-failed'] as const) {
			const row = {
				...base,
				communication,
				communicationEvidence: {
					state: communication,
					reason: 'fresh_observation',
					observedAt: new Date(now).toISOString()
				}
			};
			expect(freshStatus(row, now + 29999).communication).toBe(communication);
			expect(freshStatus(row, now + 30000).communication).toBe('unknown');
			expect(freshStatus(row, now - 1).communication).toBe('unknown');
		}
	});
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

describe('current allocation', () => {
	const allocation = (id: string, desired: string, jobVersion?: number) => ({
		id,
		desired,
		status: 'running',
		jobVersion
	});

	it('is the one Nomad wants running for the newest job version', () => {
		expect(
			currentAllocation([
				allocation('old', 'run', 2),
				allocation('stopped', 'stop', 4),
				allocation('new', 'run', 3)
			])?.id
		).toBe('new');
		expect(currentAllocation([allocation('gone', 'stop', 1)])).toBeNull();
	});

	it('feeds the detail view the same status path as the list', () => {
		const detail = {
			...base,
			allocation: undefined,
			inheritsSite: false,
			requested: 'running' as const,
			settings: {},
			image: 'i',
			previousVersion: null,
			allocations: [allocation('a', 'stop', 1), allocation('b', 'run', 2)]
		};
		expect(detailStatusInput(detail).allocation?.id).toBe('b');
		expect(statusPath(detailStatusInput(detail)).allocation).toBe('verified');
	});
});
