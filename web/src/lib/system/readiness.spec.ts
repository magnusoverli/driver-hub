import { describe, expect, it } from 'vitest';
import { ApiError } from '#lib/api/errors.js';
import type { Capabilities } from './queries.js';
import { siteReadiness } from './readiness.js';

const capabilities: Capabilities = {
	apiVersion: 'v1',
	access: 'admin',
	buildsEnabled: false,
	asyncAcquisition: true,
	siteSetupEnabled: true,
	videoIPathConfigured: true,
	nomadConfigured: true,
	imageHostConfigured: true
};

const states = (items: ReturnType<typeof siteReadiness>) =>
	Object.fromEntries(items.map((item) => [item.id, item.state]));

describe('site readiness', () => {
	it('is checking until the manager has answered', () => {
		const items = siteReadiness({ capabilities: undefined, nomad: undefined, nomadError: null });
		expect(new Set(items.map((item) => item.state))).toEqual(new Set(['checking']));
	});

	it('is ready when everything required is configured, with builds optional', () => {
		const items = siteReadiness({
			capabilities,
			nomad: { state: 'connected', namespace: 'driverhub' },
			nomadError: null
		});
		expect(states(items)).toEqual({
			nomad: 'ready',
			videoipath: 'ready',
			images: 'ready',
			builds: 'optional'
		});
		expect(items[0].detail).toContain('driverhub');
	});

	it('flags missing configuration and a cluster without a leader', () => {
		const items = siteReadiness({
			capabilities: {
				...capabilities,
				videoIPathConfigured: false,
				imageHostConfigured: false,
				buildsEnabled: true
			},
			nomad: { state: 'no_leader', namespace: 'default' },
			nomadError: null
		});
		expect(states(items)).toEqual({
			nomad: 'attention',
			videoipath: 'attention',
			images: 'attention',
			builds: 'ready'
		});
	});

	it('reports an unreachable cluster instead of an empty one', () => {
		const [nomad] = siteReadiness({
			capabilities,
			nomad: { state: 'connected', namespace: 'default' },
			nomadError: new ApiError(502, 'upstream_error', 'Nomad request failed')
		});
		expect(nomad.state).toBe('attention');
		expect(nomad.detail).toContain('Nomad request failed');
	});

	it('links only items configured in Hub to their settings', () => {
		const items = siteReadiness({ capabilities, nomad: undefined, nomadError: null });
		expect(items.map((item) => item.settingsRoute)).toEqual([
			'/(app)/site/nomad',
			'/(app)/site/videoipath',
			undefined,
			undefined
		]);
	});
});
