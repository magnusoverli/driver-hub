import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { isDeepStrictEqual } from 'node:util';
import { readRecord, requireRelease, verifyConfiguration } from './release.js';
import { checkDeclaration } from './settings.js';

export class ReleaseConflict extends Error {}

// Hash the logical key: SemVer identifiers are case-sensitive even on Windows filesystems.
function directory(root, driverId, version) {
  return join(root, createHash('sha256').update(JSON.stringify([driverId, version])).digest('hex'));
}

async function saveArchive(path, chunks, expectedHash) {
  const hash = createHash('sha256');
  async function* hashChunks() {
    for await (const chunk of chunks) {
      hash.update(chunk);
      yield chunk;
    }
  }
  await pipeline(hashChunks(), createWriteStream(path, { flags: 'wx' }));
  requireRelease(hash.digest('hex') === expectedHash, 'Archive checksum does not match the release record');
}

export class ReleaseStore {
  constructor(root) {
    this.root = root;
  }

  archivePath(driverId, version) {
    return join(directory(this.root, driverId, version), 'image.oci.tar.gz');
  }

  async list() {
    await mkdir(this.root, { recursive: true });
    const records = [];
    for (const key of await readdir(this.root)) {
      if (!/^[a-f0-9]{64}$/.test(key)) continue;
      const bytes = await readFile(join(this.root, key, 'driver-release.json'));
      const { driverId, version, displayName, image, origin = 'maintainer' } = JSON.parse(bytes);
      records.push({ driverId, version, displayName, digest: image.digest, origin });
    }
    return records;
  }

  // Renaming first makes the release disappear at once; listing skips the leftover until removed.
  async remove(driverId, version) {
    const trash = join(this.root, `.removing-${randomUUID()}`);
    try {
      await rename(directory(this.root, driverId, version), trash);
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    await rm(trash, { recursive: true, force: true });
    return true;
  }

  async load(driverId, version) {
    const path = directory(this.root, driverId, version);
    let bytes;
    try {
      bytes = await readFile(join(path, 'driver-release.json'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const record = readRecord(bytes, { driverId, version });
    const config = await readFile(join(path, 'driver-config.json'));
    return { record, configuration: checkDeclaration(verifyConfiguration(config, record)) };
  }

  async existing(record) {
    const saved = await this.load(record.driverId, record.version);
    if (saved && !isDeepStrictEqual(saved.record, record)) {
      throw new ReleaseConflict('Different content already retained for this driver version');
    }
    return saved;
  }

  async save(release, archiveChunks) {
    const { record } = release.detail;
    const saved = await this.existing(record);
    if (saved) return saved;

    await mkdir(this.root, { recursive: true });
    const staging = await mkdtemp(join(this.root, '.incoming-'));
    try {
      await saveArchive(join(staging, 'image.oci.tar.gz'), archiveChunks, record.image.archiveSha256);
      return (await this.commit(staging, release)).detail;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  // staging is private to the caller, on the same filesystem, and contains the verified archive.
  async commit(staging, release) {
    const { record } = release.detail;
    await writeFile(join(staging, 'driver-config.json'), release.configBytes);
    await writeFile(join(staging, 'driver-release.json'), release.manifestBytes);
    try {
      await rename(staging, directory(this.root, record.driverId, record.version));
      return { detail: release.detail, created: true };
    } catch (error) {
      if (!['ENOTEMPTY', 'EEXIST', 'EPERM'].includes(error.code)) throw error;
      const winner = await this.existing(record);
      if (!winner) throw error;
      return { detail: winner, created: false };
    }
  }
}
