import { describe, expect, it } from 'vitest';
import type { RetainedRelease } from '#lib/catalog/queries.js';
import type { DeploymentSummary } from './queries';
import {
	compareVersions,
	condition,
	evidenceText,
	filterQuery,
	hopExplanations,
	imageDigest,
	labelProblem,
	matchesFilter,
	matchesSearch,
	needsAttention,
	shortDigest,
	sortByName,
	updateHints,
	updateTargets
} from './view';

const running: DeploymentSummary = {
	nodeId: '11111111-1111-4111-8111-111111111111',
	driverId: 'meter',
	version: '1.2.0',
	label: 'Studio 3 meter',
	status: 'running',
	revision: 7,
	requiresOriginalStopped: false,
	requested: 'running',
	communication: 'unknown',
	communicationEvidence: { state: 'unknown', reason: 'no_control_check' },
	approval: 'unknown',
	allocation: { id: 'a', host: 'client-2', desired: 'run', status: 'running' }
};

const retained = (driverId: string, version: string, origin = 'maintainer'): RetainedRelease => ({
	driverId,
	version,
	origin,
	displayName: driverId,
	digest: `sha256:${'0'.repeat(64)}`
});

describe('condition', () => {
	it('summarises the status path in one word, never claiming control without evidence', () => {
		expect(condition(running)).toBe('running');
		expect(condition({ ...running, communication: 'driver-reports-connected' })).toBe('connected');
		expect(condition({ ...running, communication: 'check-failed' })).toBe('check-failed');
		expect(condition({ ...running, allocation: null })).toBe('starting');
		expect(condition({ ...running, allocation: { ...running.allocation!, status: 'lost' } })).toBe(
			'allocation-failed'
		);
		expect(condition({ ...running, requested: 'stopped', allocation: null })).toBe('stopped');
		expect(condition({ ...running, requested: null })).toBe('unavailable');
	});

	it('asks for attention only on evidence of failure or missing status', () => {
		expect(needsAttention('check-failed')).toBe(true);
		expect(needsAttention('allocation-failed')).toBe(true);
		expect(needsAttention('unavailable')).toBe(true);
		expect(needsAttention('starting')).toBe(false);
		expect(needsAttention('running')).toBe(false);
		expect(needsAttention('stopped')).toBe(false);
	});
});

describe('list filters', () => {
	it('keeps named devices first, alphabetically and numerically, then unnamed ones by ID', () => {
		const rows = [
			{ ...running, label: null, nodeId: 'b' },
			{ ...running, label: 'Studio 10', nodeId: 'c' },
			{ ...running, label: null, nodeId: 'a' },
			{ ...running, label: 'studio 2', nodeId: 'd' }
		];
		expect(sortByName(rows).map((row) => row.nodeId)).toEqual(['d', 'c', 'a', 'b']);
	});

	it('matches name, node ID, driver, version and client without regard to case', () => {
		expect(matchesSearch(running, 'STUDIO')).toBe(true);
		expect(matchesSearch(running, '1111-4111')).toBe(true);
		expect(matchesSearch(running, 'meter 1.2')).toBe(false);
		expect(matchesSearch(running, '1.2.0')).toBe(true);
		expect(matchesSearch(running, 'client-2')).toBe(true);
		expect(matchesSearch(running, '   ')).toBe(true);
		expect(matchesSearch({ ...running, label: null, allocation: null }, 'studio')).toBe(false);
	});

	it('groups by requested state, and by attention across states', () => {
		const unavailable = { ...running, requested: null };
		expect(matchesFilter(running, 'running')).toBe(true);
		expect(matchesFilter(running, 'stopped')).toBe(false);
		expect(matchesFilter(unavailable, 'running')).toBe(false);
		expect(matchesFilter(unavailable, 'attention')).toBe(true);
		expect(matchesFilter(unavailable, 'all')).toBe(true);
	});

	it('round-trips the view through the address query', () => {
		expect(filterQuery('', 'all')).toBe('');
		expect(filterQuery('  rack b ', 'attention')).toBe('?q=rack%20b&show=attention');
		expect(filterQuery('', 'stopped')).toBe('?show=stopped');
	});
});

describe('versions', () => {
	it('orders by SemVer precedence, including prereleases and large numbers', () => {
		const ordered = [
			'1.0.0-alpha',
			'1.0.0-alpha.1',
			'1.0.0-alpha.beta',
			'1.0.0-beta.2',
			'1.0.0-beta.11',
			'1.0.0-rc.1',
			'1.0.0',
			'1.2.0',
			'1.10.0',
			'99999999999999999999.0.0'
		];
		const shuffled = [...ordered].reverse();
		expect(shuffled.sort(compareVersions)).toEqual(ordered);
		expect(compareVersions('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
	});

	it('offers every other retained version of the same driver, newest first', () => {
		const targets = updateTargets(running, [
			retained('meter', '1.1.0'),
			retained('meter', '1.2.0'),
			retained('meter', '1.10.0'),
			retained('gateway', '9.0.0'),
			retained('meter', '0.0.0-local.20261126', 'customer')
		]);
		expect(targets.map((t) => [t.version, t.newer])).toEqual([
			['1.10.0', true],
			['1.1.0', false],
			['0.0.0-local.20261126', false]
		]);
	});

	it('never counts a customer build as outdated or as newer', () => {
		const build = { ...running, version: '0.0.0-local.1' };
		expect(updateTargets(build, [retained('meter', '2.0.0')])[0].newer).toBe(false);
	});

	it('hints at a retained update, or a newer upstream one that still has to be downloaded', () => {
		const other = { ...running, nodeId: 'other', version: '1.10.0' };
		const suggestions = [
			{ nodeId: running.nodeId, driverId: 'meter', version: '1.2.0', availableVersion: '1.3.0' },
			{ nodeId: other.nodeId, driverId: 'meter', version: '1.10.0', availableVersion: '1.11.0' }
		];
		const hints = updateHints([running, other], suggestions, [
			retained('meter', '1.3.0'),
			retained('meter', '1.10.0')
		]);
		// A newer retained version outranks an older upstream suggestion.
		expect(hints.get(running.nodeId)).toEqual({ version: '1.10.0', retained: true });
		expect(hints.get(other.nodeId)).toEqual({ version: '1.11.0', retained: false });
		// An upstream suggestion that is already retained is ready to deploy.
		expect(
			updateHints([running], suggestions, [retained('meter', '1.3.0')]).get(running.nodeId)
		).toEqual({ version: '1.3.0', retained: true });
		expect(updateHints([other], [], [retained('meter', '1.3.0')]).size).toBe(0);
	});
});

describe('evidence and hops', () => {
	it('explains why there is no evidence of control', () => {
		expect(evidenceText({ state: 'unknown', reason: 'stale_observation' })).toMatch(/30 seconds/);
		expect(evidenceText({ state: 'unknown', reason: 'something_new' })).toMatch(/something_new/);
		expect(
			evidenceText({
				state: 'driver-reports-connected',
				reason: 'fresh_observation',
				observedAt: '2026-11-26T10:00:00Z'
			})
		).toMatch(/connected at/);
	});

	it('describes where the allocation stands', () => {
		const hop = (input: Partial<DeploymentSummary>) =>
			hopExplanations({ ...running, ...input }).allocation;
		expect(hop({})).toBe('Running on client-2.');
		expect(hop({ allocation: { ...running.allocation!, restarts: 3 } })).toMatch(/restarts: 3/);
		expect(hop({ allocation: null })).toMatch(/not placed/);
		expect(hop({ allocation: { id: 'a', desired: 'run', status: 'pending' } })).toMatch(
			/an unknown client, but not running yet \(pending\)/
		);
		expect(hop({ requested: 'stopped' })).toMatch(/stopped/);
		expect(hopExplanations(running).approval).toMatch(/never shown as verified/);
	});
});

describe('labels and identifiers', () => {
	it('mirrors the manager rule for device names', () => {
		expect(labelProblem('  Studio 3 meter ')).toBeNull();
		expect(labelProblem('   ')).not.toBeNull();
		expect(labelProblem('x'.repeat(80))).toBeNull();
		expect(labelProblem('x'.repeat(81))).not.toBeNull();
		// Characters, not UTF-16 code units, as the manager counts them.
		expect(labelProblem('📟'.repeat(80))).toBeNull();
		expect(labelProblem('line\nbreak')).not.toBeNull();
	});

	it('shows the digest of a pinned image briefly', () => {
		const digest = `sha256:${'ab'.repeat(32)}`;
		expect(imageDigest(`images.site/driverhub/key@${digest}`)).toBe(digest);
		expect(shortDigest(digest)).toBe('sha256:abababababab');
		expect(shortDigest('not-a-digest')).toBe('not-a-digest');
	});
});
