import { describe, expect, it } from 'vitest';
import {
	canKeepNomadToken,
	datacentersProblem,
	namespaceProblem,
	nomadInput,
	nomadOrigin,
	parseDatacenters,
	parseTokens,
	videoIPathEndpoint,
	type Site
} from './settings';

const site: Site = {
	revision: 4,
	nomad: {
		address: 'https://nomad.site.example:4646',
		namespace: 'driverhub',
		datacenters: ['dc1'],
		tokenConfigured: true
	},
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
			token: ' secret '
		};
		expect(nomadInput(4, { ...form, tokenChoice: 'keep' })).toEqual({
			revision: 4,
			address: 'nomad.site.example',
			namespace: 'driverhub',
			datacenters: ['dc1', 'dc2']
		});
		expect(nomadInput(4, { ...form, tokenChoice: 'none' }).token).toBeNull();
		expect(nomadInput(4, { ...form, tokenChoice: 'replace' }).token).toBe('secret');
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
