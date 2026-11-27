import { describe, expect, it } from 'vitest';
import { formatDuration } from '#lib/time/format.js';
import {
	matchesOperationFilter,
	operationDuration,
	operationSubject,
	type Operation
} from './operations';

const download: Operation = {
	id: '11111111-0000-4000-8000-000000000001',
	kind: 'retain',
	state: 'succeeded',
	target: { driverId: 'meter', version: '1.4.0' },
	startedAt: '2026-11-26T10:00:00.000Z',
	finishedAt: '2026-11-26T10:03:20.000Z',
	release: { driverId: 'meter', version: '1.4.0', digest: `sha256:${'a'.repeat(64)}` }
};
const build: Operation = {
	id: '11111111-0000-4000-8000-000000000002',
	kind: 'build',
	state: 'running',
	target: { driverId: 'rust-example', commit: 'f64a319caf5f27fd46ef2ce203c71e6aa63f3d4c' },
	startedAt: '2026-11-26T10:00:00.000Z'
};

describe('operations', () => {
	it('groups failures and interruptions as needing attention', () => {
		const failed = { ...build, state: 'failed' as const };
		const interrupted = { ...download, state: 'interrupted' as const };
		expect(matchesOperationFilter(failed, 'problems')).toBe(true);
		expect(matchesOperationFilter(interrupted, 'problems')).toBe(true);
		expect(matchesOperationFilter(download, 'problems')).toBe(false);
		expect(matchesOperationFilter(build, 'running')).toBe(true);
		expect(matchesOperationFilter(download, 'succeeded')).toBe(true);
		expect(matchesOperationFilter(failed, 'all')).toBe(true);
	});

	it('names what a download or a build works on', () => {
		expect(operationSubject(download)).toEqual({ driver: 'meter', detail: '1.4.0' });
		expect(operationSubject(build)).toEqual({ driver: 'rust-example', detail: 'at f64a319caf5f' });
	});

	it('measures finished work, and running work up to now', () => {
		expect(operationDuration(download, Date.parse('2026-11-27T00:00:00Z'))).toBe(200_000);
		expect(operationDuration(build, Date.parse('2026-11-26T10:00:42Z'))).toBe(42_000);
	});

	it('formats durations briefly', () => {
		expect(formatDuration(42_000, 'en')).toBe('42s');
		expect(formatDuration(200_000, 'en')).toBe('3m 20s');
		expect(formatDuration(180_000, 'en')).toBe('3m');
		expect(formatDuration(3_900_000, 'en')).toBe('1h 5m');
	});
});
