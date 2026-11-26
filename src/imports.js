import Busboy from '@fastify/busboy';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { expect, RequestError } from './errors.js';
import { inspectArchive } from './images.js';
import { checkSource, parseJson, parseTag, readRecord, requireRelease } from './release.js';
import { checkDeclaration, isObject } from './settings.js';
import { canonicalJson } from './request-key.js';

const archiveName = 'image.oci.tar.gz';
const metadataLimit = 256 * 1024;
const archiveLimit = 2 * 1024 ** 3;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const tooLarge = () => new RequestError(413, 'Import exceeds size limit');

// Count raw request bytes too: multipart headers, preamble and epilogue are not file data.
async function receive(request, archive, limit, signal) {
  const totalLimit = limit + metadataLimit + 64 * 1024;
  expect(/^multipart\/form-data\s*(?:;|$)/i.test(request.headers['content-type'] ?? ''),
    'Expected multipart/form-data', 415);
  expect(!(Number(request.headers['content-length']) > totalLimit), 'Import exceeds size limit', 413);
  let parser;
  try {
    parser = new Busboy({ headers: request.headers, isPartAFile: name => name === 'image',
      limits: { parts: 2, fileSize: limit, fieldSize: metadataLimit, headerSize: 16 * 1024 } });
  } catch { throw new RequestError(400, 'Invalid multipart boundary'); }

  let metadata, image, writing, failure;
  let size = 0, magic = Buffer.alloc(0);
  const counter = new Transform({ transform(chunk, _, done) {
    size += chunk.length;
    if (size > totalLimit) return done(failure = tooLarge());
    done(null, chunk);
  } });
  const digest = createHash('sha256');
  function fail(error) {
    failure ??= error;
    counter.destroy(error);
  }
  parser.on('partsLimit', () => fail(new RequestError(400, 'Expected one image and at most one metadata part')));
  parser.on('field', (name, text, _shortName, truncated) => {
    if (truncated) return fail(tooLarge());
    if (name !== 'metadata' || metadata !== undefined) return fail(new RequestError(400, 'Unexpected multipart field'));
    metadata = text;
  });
  parser.on('file', (_name, stream) => {
    if (image) {
      stream.on('error', () => {}).resume();
      return fail(new RequestError(400, 'Duplicate image part'));
    }
    image = stream;
    stream.on('limit', () => fail(tooLarge()));
    const checksum = new Transform({ transform(chunk, _, done) {
      if (magic.length < 2) magic = Buffer.concat([magic, chunk.subarray(0, 2 - magic.length)]);
      digest.update(chunk);
      done(null, chunk);
    } });
    writing = pipeline(stream, checksum, createWriteStream(archive, { flags: 'wx', mode: 0o600 }))
      .catch(error => fail(error.code ? error : new RequestError(400, 'Incomplete multipart image')));
  });
  const disconnected = () => fail(new RequestError(400, 'Upload disconnected'));
  request.on('error', disconnected);
  try {
    // Do not put IncomingMessage itself in pipeline: on a size error it would destroy
    // the socket before the HTTP handler could send the 413 response.
    const parsing = pipeline(counter, parser, { signal });
    request.pipe(counter);
    await parsing;
    await writing;
    if (failure) throw failure;
  } catch {
    image?.destroy();
    await writing;
    signal.throwIfAborted();
    throw failure ?? new RequestError(400, 'Malformed multipart upload');
  } finally {
    request.unpipe(counter);
    request.removeListener('error', disconnected);
  }
  expect(image, 'An image part is required');
  expect(magic[0] === 0x1f && magic[1] === 0x8b, 'Expected a gzipped OCI image archive', 415);
  return { input: metadata === undefined ? {} : parseJson(metadata, 'Import metadata'), archiveSha256: digest.digest('hex') };
}

// One manager owns its data directory. Only the dedicated transient import workspace
// is cleaned on startup, never retained releases or ongoing acquisition records.
export class Imports {
  static async open(store, options) {
    const imports = new Imports(store, options);
    await mkdir(imports.workspace, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(imports.workspace, { withFileTypes: true })) {
      if (entry.isDirectory() && /^upload-[A-Za-z0-9]{6}$/.test(entry.name)) {
        await rm(join(imports.workspace, entry.name), { recursive: true, force: true });
      }
    }
    return imports;
  }

  constructor(store, { maxArchiveBytes = archiveLimit } = {}) {
    this.store = store;
    this.workspace = join(store.root, '.imports');
    this.limit = maxArchiveBytes;
    this.active = 0;
  }

  async upload(request, driverId, version) {
    const identity = parseTag(`drivers/${driverId}/v${version}`);
    expect(identity && identity.driverId === driverId && identity.version === version, 'Invalid driver ID or SemVer');
    expect(this.active < 2, 'Too many active image imports', 429);
    this.active++;
    const controller = new AbortController();
    const closed = () => controller.abort(new RequestError(400, 'Upload disconnected'));
    request.socket.once('close', closed);
    let staging;
    try {
      staging = await mkdtemp(join(this.workspace, 'upload-'));
      const archive = join(staging, archiveName);
      const { input, archiveSha256 } = await receive(request, archive, this.limit, controller.signal);
      requireRelease(isObject(input) && Object.keys(input).every(k => ['configuration', 'displayName', 'source'].includes(k)),
        'Invalid import metadata');
      const { displayName = driverId, configuration: declaration = { schemaVersion: 1, inputs: [] }, source } = input;
      requireRelease(typeof displayName === 'string' && displayName.trim(), 'Invalid display name');
      checkSource(source, true);
      const configuration = checkDeclaration(declaration);
      const configBytes = Buffer.from(canonicalJson(configuration));
      const image = await inspectArchive(archive, staging, controller.signal);
      controller.signal.throwIfAborted();
      const manifestBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, ...identity, displayName,
        ...(source && (source.commit || source.directory) && {source: {commit: source.commit, directory: source.directory}}), origin: 'customer',
        configuration: { file: 'driver-config.json', sha256: hash(configBytes) },
        image: { ...image, archive: archiveName, archiveSha256 } }));
      const record = readRecord(manifestBytes, identity);
      return await this.store.commit(staging, { detail: { record, configuration }, manifestBytes, configBytes });
    } finally {
      request.socket.removeListener('close', closed);
      try { if (staging) await rm(staging, { recursive: true, force: true }); }
      finally { this.active--; }
    }
  }
}
