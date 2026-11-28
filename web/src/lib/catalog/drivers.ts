import { compareVersions } from '#lib/deployments/view.js';
import type { Identity, RetainedRelease } from './queries';

/** A release as the catalog lists it upstream. */
export type PublishedRelease = Identity & { prerelease: boolean };

/** Where one version of a driver stands on this Hub. */
export type VersionState = 'downloaded' | 'downloading' | 'available';

export interface DriverVersion {
	version: string;
	prerelease: boolean;
	/** Published upstream, so it can be downloaded. */
	published: boolean;
	/** The copy on this Hub, which devices can be set up with. */
	retained?: RetainedRelease;
	state: VersionState;
	/** Imported or built on this site rather than published by the maintainers. */
	custom: boolean;
	/** Devices that run this version. */
	devices: number;
}

export interface Driver {
	driverId: string;
	/** The display name of a downloaded version, else the driver ID. */
	name: string;
	/** Newest first. */
	versions: DriverVersion[];
	/** The version to offer first: the newest stable one, or the newest of any kind. */
	latest: DriverVersion;
	/** The newest version on this Hub, which a device can be set up with right away. */
	newestDownloaded?: DriverVersion;
	/** Only imported or built on this site. */
	custom: boolean;
	/** Devices that run any version of this driver. */
	devices: number;
}

export interface CatalogInput {
	published: readonly PublishedRelease[];
	retained: readonly RetainedRelease[];
	/** Releases a download is running for. */
	downloading?: readonly Identity[];
	/** The driver and version of each device, to count where versions are used. */
	devices?: readonly Identity[];
}

const isBuild = (version: string) => version.startsWith('0.0.0-local.');
const same = (a: Identity, b: Identity) => a.driverId === b.driverId && a.version === b.version;

/**
 * One entry per driver from the published and retained releases, so a driver reads as one thing
 * with versions rather than as unrelated rows. Sorted by name.
 */
export function catalogDrivers({
	published,
	retained,
	downloading = [],
	devices = []
}: CatalogInput): Driver[] {
	const byDriver = new Map<string, Map<string, DriverVersion>>();
	const versionsOf = (driverId: string) => {
		let versions = byDriver.get(driverId);
		if (!versions) byDriver.set(driverId, (versions = new Map<string, DriverVersion>()));
		return versions;
	};
	const used = (release: Identity) => devices.filter((device) => same(device, release)).length;

	for (const release of published) {
		versionsOf(release.driverId).set(release.version, {
			version: release.version,
			prerelease: release.prerelease,
			published: true,
			state: downloading.some((item) => same(item, release)) ? 'downloading' : 'available',
			custom: false,
			devices: used(release)
		});
	}
	for (const release of retained) {
		const versions = versionsOf(release.driverId);
		const known = versions.get(release.version);
		versions.set(release.version, {
			version: release.version,
			prerelease: known?.prerelease ?? /-/.test(release.version),
			published: known?.published ?? false,
			retained: release,
			state: 'downloaded',
			custom: release.origin === 'customer',
			devices: used(release)
		});
	}
	const drivers: Driver[] = [];
	for (const [driverId, map] of byDriver) {
		const versions = [...map.values()].sort((a, b) => compareVersions(b.version, a.version));
		const stable = versions.find((version) => !version.prerelease && !isBuild(version.version));
		const newestDownloaded = versions.find((version) => version.state === 'downloaded');
		drivers.push({
			driverId,
			name: newestDownloaded?.retained?.displayName ?? driverId,
			versions,
			latest: stable ?? versions[0],
			newestDownloaded,
			custom: versions.every((version) => version.custom),
			devices: devices.filter((device) => device.driverId === driverId).length
		});
	}
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	return drivers.sort((a, b) => collator.compare(a.name, b.name));
}

/** Matches the name, driver ID or any version, ignoring case. */
export function matchesDriver(driver: Driver, query: string): boolean {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return true;
	return [driver.name, driver.driverId, ...driver.versions.map((v) => v.version)].some((value) =>
		value.toLocaleLowerCase().includes(needle)
	);
}
