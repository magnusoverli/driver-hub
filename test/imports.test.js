import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { Deployments } from '../src/deployments.js';
import { distributionServer } from '../src/distribution.js';
import { createApi } from '../src/http.js';
import { Images, imageKey } from '../src/images.js';
import { Imports } from '../src/imports.js';
import { ReleaseStore } from '../src/release-store.js';

const sha = b => createHash('sha256').update(b).digest('hex');
const metadata = { displayName: 'Meter', source: { commit: 'c'.repeat(40), directory: 'Drivers/Meter' },
  configuration: { schemaVersion: 1, inputs: [] } };
const auth = { Authorization: 'Bearer uploader' };

async function archive(tag, architectures = ['amd64'], corrupt = false) {
  const pack = tar.pack(), blobs = new Set(), manifests = [];
  const blob = (type, data) => {
    const bytes = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    const hex = sha(bytes);
    if (!blobs.has(hex)) pack.entry({ name: `blobs/sha256/${hex}` }, corrupt && type === 'layer.v1.tar' ? Buffer.from('bad') : bytes);
    blobs.add(hex);
    return { mediaType: `application/vnd.oci.image.${type}`, digest: `sha256:${hex}`, size: bytes.length };
  };
  const layer = blob('layer.v1.tar', tag);
  for (const architecture of architectures) {
    const platform = { os: 'linux', architecture };
    manifests.push({ ...blob('manifest.v1+json', { schemaVersion: 2, config: blob('config.v1+json', platform), layers: [layer] }), platform });
  }
  const index = JSON.stringify({ schemaVersion: 2, manifests });
  pack.entry({ name: 'index.json' }, index);
  pack.entry({ name: 'oci-layout' }, '{"imageLayoutVersion":"1.0.0"}');
  pack.finalize();
  const chunks = [];
  for await (const b of pack) chunks.push(b);
  return { bytes: gzipSync(Buffer.concat(chunks)), layer,
    digest: manifests.length === 1 ? manifests[0].digest : `sha256:${sha(index)}` };
}

function form(image, info = metadata) {
  const body = new FormData();
  body.append('image', new Blob([image]), 'driver.tar.gz');
  body.append('metadata', JSON.stringify(info));
  return body;
}

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function manager(t, options) {
  const root = await mkdtemp(join(tmpdir(), 'hub-imports-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ReleaseStore(join(root, 'releases'));
  const imports = await Imports.open(store, options);
  const base = `${await listen(t, createApi(null, store, { imports, token: 'uploader', viewerToken: 'viewer' }))}/api/v1`;
  const put = (body, version = '1.0.0', headers = auth) =>
    fetch(`${base}/imports/meter/${version}`, { method: 'PUT', headers, body });
  return { store, imports, root, base, put };
}

test('concurrent imports commit immutable releases once; index and archive digests are derived from bytes', async t => {
  const { store, put, base } = await manager(t);
  const a = await archive('one', ['amd64', 'arm64']);
  const res = await Promise.all([put(form(a.bytes)), put(form(a.bytes))]);
  assert.deepEqual(res.map(r => r.status).sort(), [200, 201]);
  const { record } = await res[0].json();
  assert.equal(res[0].headers.get('Location'), '/api/v1/retained/meter/1.0.0');
  assert.deepEqual(record.image.platforms, ['linux/amd64', 'linux/arm64']);
  assert.equal(record.image.digest, a.digest);
  assert.equal(record.image.archiveSha256, sha(a.bytes));
  assert.equal(record.origin, 'customer');
  assert.equal((await put(form(a.bytes, { ...metadata, configuration: { inputs: [], schemaVersion: 1 } }))).status, 200);
  const b = await archive('two');
  const race = await Promise.all([put(form(a.bytes), '2.0.0'), put(form(b.bytes), '2.0.0')]);
  assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
  const conflict = await put(form(a.bytes, { ...metadata, displayName: 'Changed' }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'release_conflict');
  assert.deepEqual((await store.load('meter', '1.0.0')).record, record);
  const details = await fetch(`${base}/retained/meter/1.0.0`, { headers: auth });
  assert.deepEqual((await details.json()).record, record);
  for (const [version, source] of [['3.0.0', { directory: 'Drivers/Meter' }], ['4.0.0', { commit: 'f'.repeat(40) }]]) {
    const partial = await put(form(a.bytes, { source }), version);
    assert.equal(partial.status, 201);
    assert.deepEqual((await partial.json()).record.source, source);
  }
});

test('disconnecting an incomplete upload cleans scratch files and frees a concurrency slot', async t => {
  const { put, imports, store } = await manager(t);
  async function incomplete() {
    const request = new PassThrough();
    request.socket = new EventEmitter();
    request.headers = { 'content-type': 'multipart/form-data; boundary=trial' };
    const reading = once(request, 'resume');
    const ended = assert.rejects(imports.upload(request, 'meter', '1.0.0'), /disconnected/);
    request.write('--trial\r\nContent-Disposition: form-data; name="image"\r\n\r\npartial');
    await reading;
    return async () => {
      request.socket.emit('close');
      request.destroy();
      await ended;
    };
  }
  const disconnect = await Promise.all([incomplete(), incomplete()]);
  const { bytes } = await archive('one');
  assert.equal((await put(form(bytes))).status, 429);
  await Promise.all(disconnect.map(close => close()));
  assert.deepEqual(await readdir(imports.workspace), []);
  assert.deepEqual(await store.list(), []);
  assert.equal((await put(form(bytes))).status, 201);
});

test('missing permissions, invalid parts, malformed archives and oversized uploads never become visible', async t => {
  const { put, store, imports, base } = await manager(t, { maxArchiveBytes: 4096 });
  const { bytes } = await archive('one');
  const small = form(bytes);
  assert.equal((await put(small, '1.0.0', {})).status, 401);
  assert.equal((await put(small, '1.0.0', { Authorization: 'Bearer viewer' })).status, 403);
  assert.equal((await put(small, 'bad-version')).status, 400);
  assert.equal((await put('not multipart')).status, 415);
  assert.equal((await put(form('not gzip'))).status, 415);
  assert.equal((await put(form(bytes.subarray(0, bytes.length - 16)))).status, 422);
  assert.equal((await put(form((await archive('one', ['amd64'], true)).bytes))).status, 422);
  assert.equal((await put(form((await archive('one', ['amd64', 'amd64'])).bytes))).status, 422);
  assert.equal((await put(form(bytes, { ...metadata, configuration: {} }))).status, 422);
  assert.equal((await put(form(bytes, { source: { commit: 'invalid' } }))).status, 422);
  const extra = form(bytes);
  extra.append('metadata', '{}');
  assert.equal((await put(extra)).status, 400);
  const incomplete = new FormData();
  incomplete.append('metadata', '{}');
  assert.equal((await put(incomplete)).status, 400);
  assert.equal((await put('--x\r\nContent-Disposition: form-data; name="image"\r\n\r\nno closing boundary',
    '1.0.0', { ...auth, 'Content-Type': 'multipart/form-data; boundary=x' })).status, 400);

  const request = new Request(base, { method: 'POST', body: form(Buffer.alloc(4097)) });
  assert.equal((await fetch(`${base}/imports/meter/1.0.0`, { method: 'PUT', duplex: 'half',
    headers: { ...auth, 'Content-Type': request.headers.get('Content-Type') }, body: request.body })).status, 413);
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await readdir(imports.workspace), []);
});

test('imported releases use the normal deployment lifecycle, allocation monitoring and health history after restart', async t => {
  const { store, root, put, imports } = await manager(t);
  const a = await archive('one'), b = await archive('two');
  const first = await put(form(a.bytes, { ...metadata, configuration: { ...metadata.configuration,
    controlHealth: { port: 8080, path: '/control' } } }));
  assert.equal(first.status, 201);
  const { record } = await first.json();
  await mkdir(join(imports.workspace, 'upload-abc123'));
  const reopened = new ReleaseStore(store.root);
  const afterRestart = await Imports.open(reopened);
  assert.deepEqual(await readdir(afterRestart.workspace), []);
  let job, checkStatus = 'success';
  const history = [];
  const nomad = { namespace: 'default', get: async () => structuredClone(job), list: async () => [job],
    allocations: async () => job.TaskGroups[0].Count ? [{ ID: 'alloc', DesiredStatus: 'run', ClientStatus: 'running',
      JobVersion: job.Version, NodeName: 'client-a', TaskStates: { driver: { State: 'running', Restarts: 1 } } }] : [],
    checks: async () => ({ control: { Check: 'driver-communication', Task: 'driver',
      Timestamp: Math.floor(Date.now() / 1000), Status: checkStatus } }),
    versions: async () => ({ Versions: [...history] }),
    submit: async (next, revision) => {
    assert.equal(revision, job?.JobModifyIndex ?? 0);
    job = { ...next, JobModifyIndex: revision + 1, Version: revision };
    history.push(structuredClone(job));
    return { revision: job.JobModifyIndex };
  } };
  const images = new Images(join(root, 'images'));
  const deployments = new Deployments({ store: reopened, images, registry: 'images.internal', nomad, datacenters: ['dc1'] });
  const base = `${await listen(t, createApi(null, reopened, { imports: afterRestart, deployments, token: 'uploader' }))}/api/v1`;
  const node = randomUUID();
  const post = (path, body) => fetch(`${base}/deployments${path}`, { method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', ...(!path && { 'Idempotency-Key': node }) }, body: JSON.stringify(body) });
  const get = async path => {
    const res = await fetch(`${base}/deployments${path}`, { headers: auth });
    assert.equal(res.status, 200);
    return res.json();
  };
  assert.equal((await post('', { driverId: 'meter', version: '1.0.0' })).status, 200);
  assert.equal((await post(`/${node}/start`, { revision: 1 })).status, 200);
  const pinned = () => job.TaskGroups[0].Tasks[0].Config.image.split('@').at(-1);
  assert.equal(pinned(), a.digest);
  const [row] = (await get('')).deployments;
  assert.equal(row.nodeId, node);
  assert.equal(row.requested, 'running');
  assert.equal(row.communication, 'driver-reports-connected');
  assert.equal(row.allocation.host, 'client-a');
  assert.equal(row.allocation.restarts, 1);
  checkStatus = 'failure';
  const failed = await get(`/${node}`);
  assert.equal(failed.communication, 'check-failed');
  assert.equal(failed.communicationEvidence.allocationId, 'alloc');
  assert.equal(failed.approval, 'unknown');
  const dist = `${await listen(t, distributionServer(images))}/v2/driverhub/${imageKey(record)}`;
  assert.equal(`sha256:${sha(Buffer.from(await (await fetch(`${dist}/manifests/${a.digest}`)).arrayBuffer()))}`, a.digest);
  assert.equal(await (await fetch(`${dist}/blobs/${a.layer.digest}`)).text(), 'one');
  const minimal = form(b.bytes);
  minimal.delete('metadata');
  const imported = await fetch(`${base}/imports/meter/2.0.0`, { method: 'PUT', headers: auth, body: minimal });
  assert.equal(imported.status, 201);
  const detail = await imported.json();
  assert.equal(detail.record.displayName, 'meter');
  assert.ok(!('source' in detail.record));
  assert.deepEqual(detail.configuration, { schemaVersion: 1, inputs: [] });
  assert.equal((await post(`/${node}/update`, { revision: 2, version: '2.0.0' })).status, 200);
  assert.equal(pinned(), b.digest);
  assert.equal((await get(`/${node}`)).communicationEvidence.reason, 'no_control_check');
  assert.equal((await post(`/${node}/rollback`, { revision: 3 })).status, 200);
  assert.equal(pinned(), a.digest);
  assert.equal((await post(`/${node}/stop`, { revision: 4 })).status, 200);
  const stopped = await get(`/${node}`);
  assert.equal(stopped.requested, 'stopped');
  assert.equal(stopped.communicationEvidence.reason, 'stopped');
  assert.deepEqual((await get(`/${node}/history`)).history.map(h => [h.version, h.requested]),
    [['1.0.0', 'stopped'], ['1.0.0', 'running'], ['2.0.0', 'running'], ['1.0.0', 'running'], ['1.0.0', 'stopped']]);
});
