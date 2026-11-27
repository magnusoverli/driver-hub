import { describe, expect, it } from 'vitest';
import {
	canKeepNomadToken,
	datacentersProblem,
	deploymentInput,
	isRemotePlainHttp,
	namespaceProblem,
	nomadInput,
	nomadOrigin,
	nomadUiOrigin,
	parseDatacenters,
	parseTokens,
	revisionFor,
	videoIPathEndpoint,
	type Site
} from './settings';

const site: Site = {
	revision: 4,
	nomad: {
		address: 'https://nomad.site.example:4646',
		distributionAddress: null,
		namespace: 'driverhub',
		datacenters: ['dc1'],
		tokenConfigured: true,
		plainHttp: false
	},
	deployment: { nomadUiOrigin: null, sharedWriters: false },
	manager: { buildsEnabled: false, buildsAvailable: false, timings: false },
	videoipath: {
		url: null,
		tokenMode: 'per-device',
		tokenConfigured: false,
		assignments: [],
		availableTokens: null,
		pool: []
	}
};

describe('site addresses', () => {
	it('normalizes a Nomad address as the manager does', () => {
		expect(nomadOrigin('nomad.site.example')).toBe('https://nomad.site.example:4646');
		expect(nomadOrigin('10.0.0.5')).toBe('https://10.0.0.5:4646');
		expect(nomadOrigin('fd00::5')).toBe('https://[fd00::5]:4646');
		expect(nomadOrigin('http://127.0.0.1:4183')).toBe('http://127.0.0.1:4183');
		expect(nomadOrigin('https://nomad.site.example')).toBe('https://nomad.site.example');
		expect(nomadOrigin('https://nomad.site.example/ui')).toBeNull();
		expect(nomadOrigin('user@nomad')).toBeNull();
		expect(nomadOrigin('')).toBeNull();
	});

	it('derives the driver WebSocket endpoint from a VideoIPath address', () => {
		expect(videoIPathEndpoint('vip.site.example')).toBe('wss://vip.site.example/x-driver/v1');
		expect(videoIPathEndpoint('https://vip.site.example:8443')).toBe(
			'wss://vip.site.example:8443/x-driver/v1'
		);
		expect(videoIPathEndpoint('wss://vip.site.example/x-driver/v1')).toBe(
			'wss://vip.site.example/x-driver/v1'
		);
		expect(videoIPathEndpoint('http://vip.site.example')).toBeNull();
		expect(videoIPathEndpoint('wss://vip.site.example/other')).toBeNull();
	});
});

describe('Nomad connection form', () => {
	it('keeps a saved token only for the same address and namespace', () => {
		const same = nomadOrigin('nomad.site.example');
		expect(canKeepNomadToken(site, same, 'driverhub')).toBe(true);
		expect(canKeepNomadToken(site, same, 'other')).toBe(false);
		expect(canKeepNomadToken(site, nomadOrigin('other.example'), 'driverhub')).toBe(false);
		expect(
			canKeepNomadToken(
				{ ...site, nomad: { ...site.nomad, tokenConfigured: false } },
				same,
				'driverhub'
			)
		).toBe(false);
	});

	it('omits the token to keep it, sends null for none, and the value to replace it', () => {
		const form = {
			address: ' nomad.site.example ',
			namespace: 'driverhub',
			datacenters: 'dc1, dc2',
			token: ' secret ',
			plainHttp: false
		};
		expect(nomadInput(4, { ...form, tokenChoice: 'keep' })).toEqual({
			revision: 4,
			address: 'nomad.site.example',
			namespace: 'driverhub',
			datacenters: ['dc1', 'dc2'],
			plainHttp: false
		});
		expect(nomadInput(4, { ...form, tokenChoice: 'none' }).token).toBeNull();
		expect(nomadInput(4, { ...form, tokenChoice: 'replace' }).token).toBe('secret');
		expect(
			nomadInput(4, { ...form, tokenChoice: 'keep', distributionAddress: ' hub.site ' })
		).toHaveProperty('distributionAddress', 'hub.site');
	});

	it('asks for permission only to send a token to another machine over plain HTTP', () => {
		expect(isRemotePlainHttp('http://192.0.2.10:4646')).toBe(true);
		expect(isRemotePlainHttp('http://127.0.0.1:4646')).toBe(false);
		expect(isRemotePlainHttp('https://nomad.site.example:4646')).toBe(false);
		expect(isRemotePlainHttp(null)).toBe(false);
	});

	it('validates namespace and datacenters like the manager', () => {
		expect(namespaceProblem('driver-hub_1')).toBeNull();
		expect(namespaceProblem('driver hub')).not.toBeNull();
		expect(parseDatacenters('dc1,  dc2 dc3,')).toEqual(['dc1', 'dc2', 'dc3']);
		expect(datacentersProblem('')).not.toBeNull();
		expect(datacentersProblem('dc-*')).toBeNull();
		expect(datacentersProblem('dc/1')).not.toBeNull();
	});

	it('reads pasted driver tokens one per line, once each', () => {
		expect(parseTokens('a\n b  \n\na\r\nc')).toEqual(['a', 'b', 'c']);
	});
});

describe('jobs form', () => {
	it('accepts only an HTTPS origin for the Nomad web interface', () => {
		expect(nomadUiOrigin('https://nomad.site.example/')).toBe('https://nomad.site.example');
		expect(nomadUiOrigin('http://nomad.site.example')).toBeNull();
		expect(nomadUiOrigin('https://nomad.site.example/ui')).toBeNull();
		expect(nomadUiOrigin('https://user:pw@nomad.site.example')).toBeNull();
	});

	it('clears empty fields instead of saving blanks', () => {
		expect(deploymentInput(7, { nomadUiOrigin: ' ', sharedWriters: true })).toEqual({
			revision: 7,
			nomadUiOrigin: null,
			sharedWriters: true
		});
		expect(
			deploymentInput(7, { nomadUiOrigin: 'https://nomad.site/', sharedWriters: false })
		).toEqual({ revision: 7, nomadUiOrigin: 'https://nomad.site', sharedWriters: false });
	});
});

describe('saving one form of several', () => {
	it('uses the current revision while its own part is unchanged', () => {
		const later = { ...site, revision: 5, manager: { ...site.manager, timings: true } };
		expect(revisionFor(site, later, 'deployment')).toBe(5);
		expect(revisionFor(site, later, 'manager')).toBe(4);
	});
});
