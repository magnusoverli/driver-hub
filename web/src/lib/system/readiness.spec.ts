import { describe, expect, it } from 'vitest';
import { ApiError } from '#lib/api/errors.js';
import type { Capabilities, ImageDistribution } from './queries.js';
import { siteReadiness, type ReadinessInput } from './readiness.js';

const capabilities: Capabilities = {
	apiVersion: 'v1',
	access: 'admin',
	buildsEnabled: false,
	asyncAcquisition: true,
	siteSetupEnabled: true,
	videoIPathConfigured: true,
	nomadConfigured: true,
	sharedWriters: false
};

const ready: ImageDistribution = {
	state: 'ready',
	source: 'http://10.0.0.5:5481',
	images: 3,
	running: 4,
	upToDate: 4,
	problems: []
};

const input = (changes: Partial<ReadinessInput> = {}): ReadinessInput => ({
	capabilities,
	nomad: { state: 'connected', namespace: 'driverhub' },
	nomadError: null,
	images: ready,
	imagesError: null,
	...changes
});

const states = (items: ReturnType<typeof siteReadiness>) =>
	Object.fromEntries(items.map((item) => [item.id, item.state]));

describe('site readiness', () => {
	it('is checking until the manager has answered', () => {
		const items = siteReadiness(
			input({ capabilities: undefined, nomad: undefined, images: undefined })
		);
		expect(new Set(items.map((item) => item.state))).toEqual(new Set(['checking']));
	});

	it('is ready when everything required is configured, with builds optional', () => {
		const items = siteReadiness(input());
		expect(states(items)).toEqual({
			nomad: 'ready',
			videoipath: 'ready',
			images: 'ready',
			builds: 'optional'
		});
		expect(items[0].detail).toContain('driverhub');
		expect(items[2].detail).toBe('Running on 4 clients, each holding every image.');
	});

	it('flags missing configuration and a cluster without a leader', () => {
		const items = siteReadiness(
			input({
				capabilities: { ...capabilities, videoIPathConfigured: false, buildsEnabled: true },
				nomad: { state: 'no_leader', namespace: 'default' },
				images: { ...ready, state: 'not_configured', running: 0, upToDate: 0 }
			})
		);
		expect(states(items)).toEqual({
			nomad: 'attention',
			videoipath: 'attention',
			images: 'attention',
			builds: 'ready'
		});
	});

	it('needs attention until every client holds every image, and names why it cannot start', () => {
		const copying = siteReadiness(
			input({ images: { ...ready, state: 'copying', upToDate: 2 } })
		)[2];
		expect(copying.state).toBe('attention');
		expect(copying.detail).toBe('Copying images: 2 of 4 clients hold every image.');
		const failing = siteReadiness(
			input({
				images: {
					...ready,
					state: 'failing',
					running: 0,
					upToDate: 0,
					problems: [{ host: 'client-1', status: 'pending', event: 'Failed Artifact Download' }]
				}
			})
		)[2];
		expect(failing.detail).toBe(
			'Clients where the image service cannot start: 1. Last event: Failed Artifact Download.'
		);
	});

	it('reports an unreachable cluster instead of an empty one', () => {
		const [nomad] = siteReadiness(
			input({ nomadError: new ApiError(502, 'upstream_error', 'Nomad request failed') })
		);
		expect(nomad.state).toBe('attention');
		expect(nomad.detail).toContain('Nomad request failed');
	});

	it('links every item to the settings page where it is changed', () => {
		const items = siteReadiness(input({ nomad: undefined }));
		expect(items.map((item) => item.settingsRoute)).toEqual([
			'/(app)/settings/nomad',
			'/(app)/settings/videoipath',
			'/(app)/settings/nomad',
			'/(app)/settings/advanced'
		]);
	});
});
