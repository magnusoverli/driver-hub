import { newerStable, parseTag, readRecord, requireRelease, verifyConfiguration } from './release.js';
import { checkDeclaration } from './settings.js';

function findAsset(release, name) {
  return release.assets?.find(asset => asset.name === name && asset.state === 'uploaded');
}

// Display names live in each release's manifest, an extra GitHub request per release. A listing
// reads at most this many new manifests, so an unauthenticated rate limit is not spent at once.
const NAME_READS_PER_LISTING = 8;

export class Catalog {
  constructor(source) {
    this.source = source;
    // Published assets do not change, so a name read once is kept for the manager's lifetime.
    this.names = new Map();
  }

  async list(includePrerelease, { named = false } = {}) {
    const entries = [];
    const newest = new Map();
    for await (const release of this.source.list()) {
      const identity = parseTag(release.tag_name);
      const manifest = findAsset(release, 'driver-release.json');
      if (release.draft || !identity || !manifest) continue;
      const prerelease = release.prerelease || identity.version.split('+')[0].includes('-');
      if (!includePrerelease && prerelease) continue;
      entries.push({ ...identity, prerelease });
      // GitHub lists the most recently published release first.
      if (!newest.has(identity.driverId)) newest.set(identity.driverId, { identity, manifest });
    }
    if (!named) return entries;
    const names = await this.displayNames([...newest.values()]);
    return entries.map(entry => names.has(entry.driverId)
      ? { ...entry, displayName: names.get(entry.driverId) }
      : entry);
  }

  /** Best effort: a name that cannot be read now is left out and tried again next time. */
  async displayNames(releases) {
    const key = ({ identity, manifest }) => `${identity.driverId}/${identity.version}/${manifest.id}`;
    const unread = releases.filter(release => !this.names.has(key(release))).slice(0, NAME_READS_PER_LISTING);
    await Promise.all(unread.map(async release => {
      try {
        const record = readRecord(await this.source.asset(release.manifest), release.identity);
        this.names.set(key(release), record.displayName.trim());
      } catch {
        // Listing must not fail because one manifest is missing or malformed.
      }
    }));
    return new Map(releases.filter(release => this.names.has(key(release)))
      .map(release => [release.identity.driverId, this.names.get(key(release))]));
  }

  async resolve(driverId, version) {
    const tag = `drivers/${driverId}/v${version}`;
    const identity = parseTag(tag);
    if (!identity) return null;
    const release = await this.source.byTag(tag);
    if (!release || release.draft || release.tag_name !== tag) return null;
    const manifest = findAsset(release, 'driver-release.json');
    if (!manifest) return null;
    const manifestBytes = await this.source.asset(manifest);
    const record = readRecord(manifestBytes, identity);
    requireRelease(record.origin === undefined || record.origin === 'maintainer', 'Invalid published release origin');
    requireRelease(!record.version.startsWith('0.0.0-local.'), 'Reserved customer build version');
    const config = findAsset(release, record.configuration.file);
    const archive = findAsset(release, record.image.archive);
    requireRelease(config && archive, 'Release is missing a required asset');
    const configBytes = await this.source.asset(config);
    const configuration = checkDeclaration(verifyConfiguration(configBytes, record));
    return { detail: { record, configuration }, manifestBytes, configBytes, archive };
  }

  async updates(deployments) {
    const latest = new Map();
    for (const { driverId, version } of await this.list(false)) {
      if (!latest.has(driverId) || newerStable(version, latest.get(driverId))) latest.set(driverId, version);
    }
    return deployments.flatMap(({ nodeId, driverId, version }) => {
      const candidate = latest.get(driverId);
      if (!candidate || version.startsWith('0.0.0-local.') || !newerStable(candidate, version)) return [];
      return [{ nodeId, driverId, version, availableVersion: candidate }];
    });
  }

  async load(driverId, version) {
    const release = await this.resolve(driverId, version);
    return release?.detail ?? null;
  }

  async retain(driverId, version, store) {
    const release = await this.resolve(driverId, version);
    if (!release) return null;
    return store.save(release, this.source.archive(release.archive));
  }
}
