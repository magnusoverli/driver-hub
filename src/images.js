import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import { InvalidRelease, parseJson, requireRelease } from './release.js';

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const oci = 'application/vnd.oci.image.';
const manifestType = `${oci}manifest.v1+json`;
const indexType = `${oci}index.v1+json`;
const maxMetadata = 8 * 1024 ** 2;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function imageKey(record) {
  return hash(JSON.stringify([record.driverId, record.version, record.image.digest]));
}

async function unpack(archive, dir) {
  const entries = new Map();
  const extract = tar.extract();
  async function* bounded(source) {
    let size = 0;
    for await (const chunk of source) {
      size += chunk.length;
      requireRelease(size <= 8 * 1024 ** 3, 'Expanded archive exceeds limit');
      yield chunk;
    }
  }
  let count = 0;
  async function consume() {
    for await (const entry of extract) {
      const name = entry.header.name.replace(/^\.\//, '');
      requireRelease(++count <= 32768, 'Too many archive entries');
      const blob = /^blobs\/sha256\/([0-9a-f]{64})$/.exec(name);
      const metadata = name === 'index.json' || name === 'oci-layout';
      if (!blob && !metadata) {
        entry.resume();
        continue;
      }
      requireRelease(entry.header.type === 'file' && !entries.has(name), 'Invalid or duplicate OCI entry');
      if (metadata) requireRelease(entry.header.size <= maxMetadata, 'Oversized OCI metadata');
      const digest = createHash('sha256');
      async function* chunks() {
        for await (const chunk of entry) {
          digest.update(chunk);
          yield chunk;
        }
      }
      await pipeline(chunks(), createWriteStream(join(dir, blob ? blob[1] : name), { flags: 'wx' }));
      const hex = digest.digest('hex');
      requireRelease(!blob || hex === blob[1], 'Corrupt OCI blob');
      entries.set(name, { hex, size: entry.header.size });
    }
  }
  try {
    await Promise.all([pipeline(createReadStream(archive), createGunzip(), bounded, extract), consume()]);
  } catch (error) {
    extract.destroy();
    if (error instanceof InvalidRelease || ['ENOSPC', 'EACCES', 'ENOENT'].includes(error.code)) throw error;
    throw new InvalidRelease('Invalid compressed OCI archive', { cause: error });
  }
  return entries;
}

async function verifyGraph(dir, entries, record) {
  const metadata = async file => parseJson(await readFile(join(dir, file)), 'OCI metadata');
  requireRelease(entries.has('oci-layout') && entries.has('index.json'), 'Missing OCI layout');
  requireRelease((await metadata('oci-layout'))?.imageLayoutVersion === '1.0.0', 'Unsupported OCI layout');
  const index = await metadata('index.json');
  const target = record.image.digest;
  const indexEntry = entries.get('index.json');
  const indexDigest = `sha256:${indexEntry.hex}`;
  requireRelease(index?.schemaVersion === 2 && Array.isArray(index.manifests), 'Invalid OCI index');
  const root = indexDigest === target
    ? { mediaType: indexType, digest: target, size: indexEntry.size }
    : index.manifests.find(item => item?.digest === target);
  requireRelease(root, 'Declared image digest is not a root of this OCI archive');

  // Persist only descriptors reachable from the selected image in the serving index.
  const objects = {};
  const platforms = new Set();
  async function visit(descriptor, role, depth) {
    requireRelease(depth <= 8 && digestPattern.test(descriptor?.digest) &&
      typeof descriptor.mediaType === 'string' && /^[\w.+/-]+$/.test(descriptor.mediaType), 'Invalid OCI descriptor');
    const { digest, size, mediaType } = descriptor;
    const hex = digest.slice(7);
    const file = digest === indexDigest ? 'index.json' : hex;
    const entry = entries.get(file === 'index.json' ? file : `blobs/sha256/${hex}`);
    requireRelease(entry && size === entry.size, 'Missing OCI content or size mismatch');
    if (objects[digest]) {
      requireRelease(objects[digest].role === role && objects[digest].mediaType === mediaType, 'Inconsistent OCI descriptor');
      return;
    }
    objects[digest] = { file, size, mediaType, role };
    if (role === 'layer') return;
    requireRelease(size <= maxMetadata, 'Oversized OCI metadata');
    const object = await metadata(file);
    if (role === 'config') {
      requireRelease(typeof object?.os === 'string' && typeof object.architecture === 'string', 'Missing image platform');
      const platform = `${object.os}/${object.architecture}`;
      platforms.add(platform);
      if (object.variant) platforms.add(`${platform}/${object.variant}`);
      return;
    }
    requireRelease(object?.schemaVersion === 2, 'Invalid OCI manifest schema');
    if (mediaType === indexType && Array.isArray(object.manifests)) {
      for (const child of object.manifests) await visit(child, 'manifest', depth + 1);
    } else {
      requireRelease(mediaType === manifestType && Array.isArray(object.layers), 'Unsupported OCI manifest');
      await visit(object.config, 'config', depth + 1);
      for (const layer of object.layers) await visit(layer, 'layer', depth + 1);
    }
  }
  await visit(root, 'manifest', 0);
  requireRelease(record.image.platforms.every(p => platforms.has(p)), 'Image does not contain declared platforms');
  return { digest: target, objects };
}

export class Images {
  constructor(root) { this.root = root; }

  async info(key) {
    if (!/^[0-9a-f]{64}$/.test(key)) return null;
    try {
      return JSON.parse(await readFile(join(this.root, key, 'verified.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async publish(record, archive) {
    const key = imageKey(record);
    if (await this.info(key)) return key;
    await mkdir(this.root, { recursive: true });
    const staging = await mkdtemp(join(this.root, '.verify-'));
    try {
      const entries = await unpack(archive, staging);
      const verified = await verifyGraph(staging, entries, record);
      await writeFile(join(staging, 'verified.json'), JSON.stringify(verified));
      try {
        await rename(staging, join(this.root, key));
      } catch (error) {
        if (!await this.info(key)) throw error;
      }
      return key;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
