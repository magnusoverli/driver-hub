import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import { InvalidRelease, parseJson, requireRelease } from './release.js';

export const digestPattern = /^sha256:[0-9a-f]{64}$/;
const oci = 'application/vnd.oci.image.';
const manifestType = `${oci}manifest.v1+json`;
const indexType = `${oci}index.v1+json`;
const maxMetadata = 8 * 1024 ** 2;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function imageKey(record) {
  return hash(JSON.stringify([record.driverId, record.version, record.image.digest]));
}

async function unpack(archive, dir, signal) {
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
    await Promise.all([pipeline(createReadStream(archive), createGunzip(), bounded, extract, { signal }), consume()]);
  } catch (error) {
    extract.destroy();
    signal?.throwIfAborted();
    if (error instanceof InvalidRelease || ['ENOSPC', 'EACCES', 'ENOENT'].includes(error.code)) throw error;
    throw new InvalidRelease('Invalid compressed OCI archive', { cause: error });
  }
  return entries;
}

async function verifyGraph(dir, entries, image, signal) {
  const metadata = async file => parseJson(await readFile(join(dir, file)), 'OCI metadata');
  requireRelease(entries.has('oci-layout') && entries.has('index.json'), 'Missing OCI layout');
  requireRelease((await metadata('oci-layout'))?.imageLayoutVersion === '1.0.0', 'Unsupported OCI layout');
  const index = await metadata('index.json');
  const indexEntry = entries.get('index.json');
  const indexDigest = `sha256:${indexEntry.hex}`;
  requireRelease(index?.schemaVersion === 2 && Array.isArray(index.manifests) && index.manifests.length, 'Invalid OCI index');
  // Published records pin their root. For imports, infer one image, never choose an
  // arbitrary tag from an archive containing several images.
  if (!image && index.manifests.length > 1) requirePlatformIndex(index.manifests);
  const target = image?.digest ?? (index.manifests.length === 1 ? index.manifests[0]?.digest : indexDigest);
  const root = indexDigest === target
    ? { mediaType: indexType, digest: target, size: indexEntry.size }
    : index.manifests.find(item => item?.digest === target);
  requireRelease(root, 'Declared image digest is not a root of this OCI archive');

  // Persist only descriptors reachable from the selected image in the serving index.
  const objects = {};
  const platforms = new Set();
  const configPlatforms = new Map();
  async function visit(descriptor, role, depth) {
    signal?.throwIfAborted();
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
      requireRelease(typeof object?.os === 'string' && object.os && typeof object.architecture === 'string' &&
        object.architecture && (object.variant === undefined || typeof object.variant === 'string'), 'Missing image platform');
      const platform = `${object.os}/${object.architecture}`;
      platforms.add(platform);
      if (object.variant) platforms.add(`${platform}/${object.variant}`);
      if (!image) configPlatforms.set(digest, { os: object.os, architecture: object.architecture, variant: object.variant });
      return;
    }
    requireRelease(object?.schemaVersion === 2, 'Invalid OCI manifest schema');
    if (mediaType === indexType && Array.isArray(object.manifests)) {
      if (!image) {
        requireRelease(object.manifests.length, 'Empty OCI index');
        if (object.manifests.length > 1) requirePlatformIndex(object.manifests);
      }
      for (const child of object.manifests) await visit(child, 'manifest', depth + 1);
    } else {
      requireRelease(mediaType === manifestType && Array.isArray(object.layers), 'Unsupported OCI manifest');
      await visit(object.config, 'config', depth + 1);
      if (!image && descriptor.platform) {
        const actual = configPlatforms.get(object.config.digest);
        const { os, architecture, variant } = descriptor.platform;
        requireRelease(os === actual.os && architecture === actual.architecture && (!variant || variant === actual.variant),
          'OCI platform does not match the image configuration');
      }
      for (const layer of object.layers) await visit(layer, 'layer', depth + 1);
    }
  }
  await visit(root, 'manifest', 0);
  requireRelease(platforms.size && (!image || image.platforms.every(p => platforms.has(p))), 'Image does not contain declared platforms');
  return { digest: target, objects, platforms: [...platforms].sort() };
}

function requirePlatformIndex(descriptors) {
  const names = new Set(), platforms = new Set(), digests = new Set();
  for (const d of descriptors) {
    requireRelease(d?.mediaType === manifestType && d.platform?.os && d.platform.architecture,
      'Expected one image or a platform-indexed image');
    names.add(d.annotations?.['org.opencontainers.image.ref.name'] ?? '');
    platforms.add(JSON.stringify([d.platform.os, d.platform.architecture, d.platform.variant]));
    digests.add(d.digest);
  }
  requireRelease(names.size === 1 && platforms.size === descriptors.length && digests.size === descriptors.length,
    'Ambiguous OCI archive: export a single image');
}

// Verify actual uploaded bytes, even if a published image with this digest already exists.
export async function inspectArchive(archive, workspace, signal) {
  const staging = await mkdtemp(join(workspace, '.verify-'));
  try {
    const { digest, platforms } = await verifyGraph(staging, await unpack(archive, staging, signal), undefined, signal);
    return { digest, platforms };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export class Images {
  constructor(root) { this.root = root; }

  // Every published image, as the keys and root digests that copies on Nomad clients must hold.
  async list() {
    let names;
    try { names = await readdir(this.root); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const listed = [];
    for (const key of names.filter(name => /^[0-9a-f]{64}$/.test(name)).sort()) {
      const info = await this.info(key);
      if (digestPattern.test(info?.digest)) listed.push({ key, digest: info.digest });
    }
    return listed;
  }

  async info(key) {
    if (!/^[0-9a-f]{64}$/.test(key)) return null;
    try {
      return JSON.parse(await readFile(join(this.root, key, 'verified.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  // Only for a release no deployment uses: serving replicas then have nothing to pull.
  async remove(record) {
    const key = imageKey(record);
    const trash = join(this.root, `.removing-${randomUUID()}`);
    try {
      await rename(join(this.root, key), trash);
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    await rm(trash, { recursive: true, force: true });
    return true;
  }

  async publish(record, archive) {
    const key = imageKey(record);
    const published = await this.info(key);
    if (published) {
      requireRelease(published.digest === record.image.digest && published.objects?.[published.digest],
        'Invalid published image index');
      for (const item of Object.values(published.objects)) {
        const file = await stat(join(this.root, key, item.file)).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        });
        requireRelease(file?.isFile() && file.size === item.size, 'Published image is incomplete; restore the verified image store');
      }
      return key;
    }
    await mkdir(this.root, { recursive: true });
    const staging = await mkdtemp(join(this.root, '.verify-'));
    try {
      const entries = await unpack(archive, staging);
      const verified = await verifyGraph(staging, entries, record.image);
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
