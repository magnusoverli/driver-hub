import { describe, expect, it } from 'vitest';
import type { RetainedRelease } from './queries';
import { catalogDrivers, matchesDriver } from './drivers';

const retained = (
	driverId: string,
	version: string,
	displayName: string,
	origin = 'maintainer'
): RetainedRelease => ({ driverId, version, displayName, origin }) as RetainedRelease;

describe('catalogDrivers', () => {
	const drivers = catalogDrivers({
		published: [
			{ driverId: 'exampleco-meter', version: '1.5.0', prerelease: false },
			{ driverId: 'exampleco-meter', version: '1.4.0', prerelease: false },
			{ driverId: 'exampleco-meter', version: '1.6.0-rc.1', prerelease: true },
			{
				driverId: 'rust-example',
				version: '0.3.0',
				prerelease: false,
				displayName: 'Rust teaching example'
			}
		],
		retained: [
			retained('exampleco-meter', '1.4.0', 'ExampleCo Meter'),
			retained('site-probe', '0.0.0-local.abc', 'Site probe', 'customer')
		],
		downloading: [{ driverId: 'rust-example', version: '0.3.0' }],
		devices: [
			{ driverId: 'exampleco-meter', version: '1.4.0' },
			{ driverId: 'exampleco-meter', version: '1.4.0' },
			{ driverId: 'site-probe', version: '0.0.0-local.abc' }
		]
	});
	const byId = new Map(drivers.map((driver) => [driver.driverId, driver]));

	it('lists each driver once, by name, with its versions newest first', () => {
		expect(drivers.map((driver) => driver.name)).toEqual([
			'ExampleCo Meter',
			'Rust teaching example',
			'Site probe'
		]);
		expect(byId.get('exampleco-meter')?.versions.map((v) => v.version)).toEqual([
			'1.6.0-rc.1',
			'1.5.0',
			'1.4.0'
		]);
	});

	it('offers the newest stable version first and knows which one is downloaded', () => {
		const meter = byId.get('exampleco-meter');
		expect(meter?.latest.version).toBe('1.5.0');
		expect(meter?.latest.state).toBe('available');
		expect(meter?.newestDownloaded?.version).toBe('1.4.0');
		expect(meter?.versions.find((v) => v.version === '1.4.0')?.published).toBe(true);
	});

	it('marks running downloads, custom drivers and device counts', () => {
		expect(byId.get('rust-example')?.latest.state).toBe('downloading');
		expect(byId.get('site-probe')?.custom).toBe(true);
		expect(byId.get('site-probe')?.latest.version).toBe('0.0.0-local.abc');
		expect(byId.get('exampleco-meter')?.devices).toBe(2);
		expect(byId.get('exampleco-meter')?.versions.find((v) => v.version === '1.4.0')?.devices).toBe(
			2
		);
	});

	it('matches drivers by name, ID or version', () => {
		const meter = byId.get('exampleco-meter')!;
		expect(matchesDriver(byId.get('rust-example')!, 'teaching')).toBe(true);
		expect(matchesDriver(meter, 'example')).toBe(true);
		expect(matchesDriver(meter, '1.5')).toBe(true);
		expect(matchesDriver(meter, 'gateway')).toBe(false);
	});
});
