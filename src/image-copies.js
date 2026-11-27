import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { digestPattern } from './images.js';

const keyPattern = /^[0-9a-f]{64}$/;
const roles = new Set(['manifest', 'config', 'layer']);
const maxObjects = 4096;
const maxObject = 8 * 1024 ** 3;

// The verified index an image was published with, as another copy or the manager serves it. The
// root digest comes from Hub's own list, so a source can never substitute another image.
function checkIndex(info, digest) {
  if (info?.digest !== digest || !info.objects || typeof info.objects !== 'object' ||
    !Array.isArray(info.platforms)) return false;
  const objects = Object.entries(info.objects);
  if (!objects.length || objects.length > maxObjects || !info.objects[digest] ||
    info.objects[digest].role !== 'manifest') return false;
  return objects.every(([id, item]) => digestPattern.test(id) && roles.has(item?.role) &&
    Number.isSafeInteger(item.size) && item.size >= 0 && item.size <= maxObject &&
    typeof item.mediaType === 'string' && /^[\w.+/-]+$/.test(item.mediaType) &&
    (item.file === id.slice(7) || (item.file === 'index.json' && item.role === 'manifest')));
}

async function download(url, file, digest, size, request) {
  const response = await request(url, { signal: AbortSignal.timeout(30 * 60 * 1000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const hash = createHash('sha256');
  let received = 0;
  async function* counted(source) {
    for await (const chunk of source) {
      received += chunk.length;
      if (received > size) throw new Error('Larger than its descriptor');
      hash.update(chunk);
      yield chunk;
    }
  }
  await pipeline(Readable.fromWeb(response.body), counted, createWriteStream(file, { flags: 'wx' }));
  if (received !== size || `sha256:${hash.digest('hex')}` !== digest) throw new Error('Content does not match its digest');
}

// Copies of Hub's verified images, kept by the image service on a Nomad client. Each image is
// fetched whole into a staging directory and published by one rename, like the manager's store.
async function olderThan(path, milliseconds) {
  const info = await stat(path).catch(() => null);
  return !info || Date.now() - info.mtimeMs > milliseconds;
}

export class ImageCopies {
  // `grace`: how long an image Hub does not list is kept, because it may have been fetched on
  // demand before Hub's list reached this client.
  constructor(images, { request = fetch, grace = 60 * 60 * 1000 } = {}) {
    this.images = images;
    this.request = request;
    this.grace = grace;
    this.pending = new Map();
  }

  // Fetches one image from the first source that has it. Resolves true when it is here.
  copy(key, digest, sources) {
    if (!keyPattern.test(key) || !digestPattern.test(digest)) return Promise.resolve(false);
    if (!this.pending.has(key)) {
      const run = this.fetch(key, digest, sources).finally(() => this.pending.delete(key));
      this.pending.set(key, run);
    }
    return this.pending.get(key);
  }

  // For a pull of an image not here yet. A driver may start before Hub's list reached this
  // client, so an image not listed yet is fetched by the root digest Docker asks for: the
  // driver's job pins that digest, so a source cannot substitute another image.
  onDemand(wanted, key, digest, kind) {
    if (!wanted) return Promise.resolve(false);
    const item = wanted.images.find(entry => entry.key === key);
    if (item) return this.copy(item.key, item.digest, wanted.sources);
    return kind === 'manifests' ? this.copy(key, digest, wanted.sources) : Promise.resolve(false);
  }

  async fetch(key, digest, sources) {
    if ((await this.images.info(key))?.digest === digest) return true;
    for (const source of sources) {
      await mkdir(this.images.root, { recursive: true });
      const staging = await mkdtemp(join(this.images.root, '.copy-'));
      try {
        const answer = await this.request(`${source}/_hub/images/${key}`,
          { signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (!answer.ok) continue;
        const info = await answer.json();
        if (!checkIndex(info, digest)) continue;
        for (const [id, item] of Object.entries(info.objects)) {
          const kind = item.role === 'manifest' ? 'manifests' : 'blobs';
          await download(`${source}/v2/driverhub/${key}/${kind}/${id}`, join(staging, item.file), id, item.size, this.request);
        }
        await writeFile(join(staging, 'verified.json'), JSON.stringify(info));
        try {
          await rename(staging, join(this.images.root, key));
        } catch (error) {
          if ((await this.images.info(key))?.digest !== digest) throw error;
        }
        return true;
      } catch {
        // Try the next source; a failed copy leaves nothing behind.
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
    return false;
  }

  // Makes the copies match Hub's list: fetches what is missing, removes what Hub no longer keeps.
  // Returns how many listed images are still missing.
  async sync({ images, sources }) {
    const wanted = new Map(images.map(item => [item.key, item.digest]));
    let missing = 0;
    for (const [key, digest] of wanted) if (!await this.copy(key, digest, sources)) missing++;
    let names = [];
    try { names = await readdir(this.images.root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const name of names) {
      // An image fetched on demand may not be listed yet, so unlisted copies get a grace period.
      // Leftovers of an interrupted copy go too, but never while a copy is running.
      const stale = keyPattern.test(name)
        ? !wanted.has(name) && !this.pending.has(name) && await olderThan(join(this.images.root, name), this.grace)
        : name.startsWith('.copy-') && !this.pending.size;
      if (stale) await rm(join(this.images.root, name), { recursive: true, force: true });
    }
    return { missing };
  }
}

// The list the manager writes for the copies, parsed defensively: a bad list keeps the last one.
export function parseWanted(text) {
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(value?.images) || !Array.isArray(value.sources)) return null;
  const images = value.images.filter(item => keyPattern.test(item?.key) && digestPattern.test(item.digest));
  const sources = value.sources.filter(source => typeof source === 'string' && /^http:\/\/[\w.:[\]-]+$/.test(source));
  return { images, sources };
}
