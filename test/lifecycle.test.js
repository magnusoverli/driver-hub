import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { Images } from '../src/images.js';
import { distributionServer } from '../src/distribution.js';
import { ReleaseStore } from '../src/release-store.js';
import { Deployments } from '../src/deployments.js';
import { createApi } from '../src/http.js';
import { Nomad } from '../src/nomad.js';
import { Builds } from '../src/builds.js';

const hash = b => createHash('sha256').update(b).digest('hex');
const encode = obj => Buffer.from(JSON.stringify(obj));
const nodeId = '087aa0f0-8ee9-49f0-aa74-127014499fc1';
const configuration = { schemaVersion: 1, controlHealth: { port: 8080, path: '/control' }, inputs: [
  { name: 'credential', secret: true, type: 'string', required: true, file: '/run/secrets/token' }
] };

async function archive(version, corrupt = false) {
  const pack = tar.pack();
  function descriptor(mediaType, bytes) {
    const hex = hash(bytes);
    pack.entry({ name: `blobs/sha256/${hex}` }, corrupt && mediaType.endsWith('.tar') ? Buffer.from('x') : bytes);
    return { mediaType, digest: `sha256:${hex}`, size: bytes.length };
  }
  const type = 'application/vnd.oci.image.';
  const config = descriptor(`${type}config.v1+json`, encode({ os: 'linux', architecture: 'amd64' }));
  const layer = descriptor(`${type}layer.v1.tar`, Buffer.from(version));
  const manifest = descriptor(`${type}manifest.v1+json`, encode({ schemaVersion: 2, config, layers: [layer] }));
  pack.entry({ name: 'index.json' }, encode({ schemaVersion: 2, manifests: [manifest] }));
  pack.entry({ name: 'oci-layout' }, encode({ imageLayoutVersion: '1.0.0' }));
  pack.finalize();
  const chunks = [];
  for await (const chunk of pack) chunks.push(chunk);
  return { raw: Buffer.concat(chunks), manifest, layer };
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'driverhub-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, images: new Images(join(root, 'images')), store: new ReleaseStore(join(root, 'releases')) };
}

async function retain(store, version, corrupt) {
  const { raw, manifest, layer } = await archive(version, corrupt);
  const bytes = gzipSync(raw);
  const configBytes = encode(configuration);
  const record = {
    driverId: 'meter', displayName: 'Meter', version, schemaVersion: 1,
    source: { commit: 'a'.repeat(40), directory: 'Drivers/Vendor/Meter' },
    configuration: { file: 'driver-config.json', sha256: hash(configBytes) },
    image: { archive: 'meter.tar.gz', digest: manifest.digest, platforms: ['linux/amd64'], archiveSha256: hash(bytes) }
  };
  await store.save({ detail: { record, configuration }, manifestBytes: encode(record), configBytes }, Readable.from([bytes]));
  return { record, layer };
}

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('a separately restarted distribution service serves verified bytes by digest, without a manager', async t => {
  const { root, store, images } = await setup(t);
  const { record, layer } = await retain(store, '1.0.0');
  const key = await images.publish(record, store.archivePath('meter', record.version));
  const addr = await listen(t, distributionServer(new Images(join(root, 'images'))));
  const base = `${addr}/v2/driverhub/${key}`;
  const manifest = await fetch(`${base}/manifests/${record.image.digest}`);
  assert.equal(`sha256:${hash(Buffer.from(await manifest.arrayBuffer()))}`, record.image.digest);
  assert.equal((await fetch(`${base}/blobs/${layer.digest}`)).status, 200);
  assert.equal((await fetch(`${base}/blobs/${layer.digest}`, { method: 'HEAD' })).headers.get('content-length'), '5');
  assert.equal((await fetch(`${base}/manifests/latest`)).status, 404);
  const broken = await retain(store, '2.0.0', true);
  await assert.rejects(images.publish(broken.record, store.archivePath('meter', '2.0.0')), /Corrupt OCI blob/);
});

test('source build uses a pinned upstream context and retains separate customer provenance', async t => {
  const { store, images } = await setup(t);
  const commit = 'c'.repeat(40);
  const builds = new Builds(store, async (context, root) => {
    assert.equal(context, `https://github.com/VideoIPath/VideoIPath_External_Drivers.git#${commit}:Drivers/Vendor/Meter`);
    const { raw, manifest } = await archive('source');
    await writeFile(join(root, 'image.tar'), raw);
    await writeFile(join(root, 'metadata.json'), encode({ 'containerimage.digest': manifest.digest }));
  });
  const { record } = await builds.create({ driverId: 'meter', commit, configuration, directory: 'Drivers/Vendor/Meter' });
  assert.equal(record.origin, 'customer');
  assert.equal(record.source.commit, commit);
  assert.match(record.version, /^0\.0\.0-local\./);
  assert.ok(await images.publish(record, store.archivePath(record.driverId, record.version)));
  assert.equal((await store.list())[0].origin, 'customer');
});

test('migration, guarded start, update, rollback and stop use one stable Nomad job', async t => {
  const { store, images } = await setup(t);
  await retain(store, '1.0.0');
  await retain(store, '2.0.0');
  let job;
  let observedAt = Math.floor(Date.now() / 1000);
  const nomad = new Nomad('http://nomad.invalid', null, 'default', async (url, request) => {
    if (url.pathname.endsWith('/plan')) return Response.json({ FailedTGAllocs: {} });
    if (url.pathname === '/v1/jobs' && request.method === 'POST') {
      const { Job, EnforceIndex, JobModifyIndex } = JSON.parse(request.body);
      assert.ok(EnforceIndex);
      assert.equal(JobModifyIndex, job?.JobModifyIndex ?? 0);
      job = { ...Job, JobModifyIndex: JobModifyIndex + 1, Version: JobModifyIndex };
      return Response.json({ JobModifyIndex: job.JobModifyIndex, EvalID: 'eval' });
    }
    if (url.pathname.endsWith('/allocations')) {
      return Response.json([{ ID: 'alloc', DesiredStatus: 'run', ClientStatus: 'running', JobVersion: job.Version }]);
    }
    if (url.pathname.endsWith('/checks')) {
      return Response.json({ check: { Check: 'driver-communication', Task: 'driver', Timestamp: observedAt, Status: 'success' } });
    }
    assert.equal(url.pathname, `/v1/job/driverhub-${nodeId}`);
    return job ? Response.json(job) : new Response(null, { status: 404 });
  });
  const deployments = new Deployments({ store, images, nomad, registry: 'driverhub-images.internal', datacenters: ['dc1'] });
  const base = `${await listen(t, createApi(null, store, { deployments }))}/api/v1/deployments`;
  const post = (suffix, body) => fetch(`${base}${suffix}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const stage = await post('', { nodeId, driverId: 'meter', version: '1.0.0', settings: { credential: { secretRef: 'key' } } });
  assert.equal(stage.status, 200);
  assert.equal(job.TaskGroups[0].Count, 0);
  const start = `/${nodeId}/start`;
  assert.equal((await post(start, { revision: 1 })).status, 409);
  assert.equal((await post(start, { revision: 1, originalStopped: true })).status, 200);
  const original = job.TaskGroups[0].Tasks[0].Config.image;
  assert.equal(job.TaskGroups[0].Count, 1);
  assert.equal((await (await fetch(`${base}/${nodeId}`)).json()).communication, 'driver-reports-connected');
  observedAt -= 60;
  assert.equal((await (await fetch(`${base}/${nodeId}`)).json()).communication, 'unknown');
  const update = `/${nodeId}/update`;
  assert.equal((await post(update, { revision: 1, version: '2.0.0' })).status, 409);
  assert.equal((await post(update, { revision: 2, version: '2.0.0', settings: {} })).status, 422);
  assert.equal((await post(update, { revision: 2, version: '2.0.0' })).status, 200);
  assert.notEqual(job.TaskGroups[0].Tasks[0].Config.image, original);
  assert.equal((await (await post(update, { revision: 3, version: '2.0.0' })).json()).unchanged, true);
  assert.equal((await post(`/${nodeId}/rollback`, { revision: 3 })).status, 200);
  assert.equal(job.TaskGroups[0].Tasks[0].Config.image, original);
  assert.equal(job.TaskGroups[0].Tasks[0].Env.VIDEOIPATH_NODE_ID, nodeId);
  assert.equal((await post(`/${nodeId}/stop`, { revision: 4 })).status, 200);
  assert.equal(job.TaskGroups[0].Count, 0);
});
