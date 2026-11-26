import { parseTag, readRecord, requireRelease, verifyConfiguration } from './release.js';
import { checkDeclaration } from './settings.js';

function findAsset(release, name) {
  return release.assets?.find(asset => asset.name === name && asset.state === 'uploaded');
}

export class Catalog {
  constructor(source) {
    this.source = source;
  }

  async list(includePrerelease) {
    const entries = [];
    for await (const release of this.source.list()) {
      const identity = parseTag(release.tag_name);
      if (release.draft || !identity || !findAsset(release, 'driver-release.json')) continue;
      const prerelease = release.prerelease || identity.version.split('+')[0].includes('-');
      if (includePrerelease || !prerelease) entries.push({ ...identity, prerelease });
    }
    return entries;
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
    const config = findAsset(release, record.configuration.file);
    const archive = findAsset(release, record.image.archive);
    requireRelease(config && archive, 'Release is missing a required asset');
    const configBytes = await this.source.asset(config);
    const configuration = checkDeclaration(verifyConfiguration(configBytes, record));
    return { detail: { record, configuration }, manifestBytes, configBytes, archive };
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
