import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { createApi } from '../src/http.js';
import { Deployments } from '../src/deployments.js';
import { Images, imageKey } from '../src/images.js';
import { DeploymentLabels } from '../src/labels.js';
import { Nomad } from '../src/nomad.js';
import { ReleaseStore } from '../src/release-store.js';
import { Site } from '../src/site.js';

// Stands in for the API token store; the HTTP layer only asks for a bearer token's role.
const viewerTokens = (...tokens) => ({ role: header => tokens.some(t => header === `Bearer ${t}`) ? 'viewer' : null });

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value));
const configuration = { schemaVersion: 1, inputs: [] };

async function retain(store, version) {
  const pack = tar.pack();
  const blob = (mediaType, bytes) => {
    pack.entry({ name: `blobs/sha256/${hash(bytes)}` }, bytes);
    return { mediaType, digest: `sha256:${hash(bytes)}`, size: bytes.length };
  };
  const type = 'application/vnd.oci.image.';
  const config = blob(`${type}config.v1+json`, encode({ os: 'linux', architecture: 'amd64' }));
  const layer = blob(`${type}layer.v1.tar`, Buffer.from(version));
  const manifest = blob(`${type}manifest.v1+json`, encode({ schemaVersion: 2, config, layers: [layer] }));
  pack.entry({ name: 'index.json' }, encode({ schemaVersion: 2, manifests: [manifest] }));
  pack.entry({ name: 'oci-layout' }, encode({ imageLayoutVersion: '1.0.0' }));
  pack.finalize();
  const chunks = [];
  for await (const chunk of pack) chunks.push(chunk);
  const bytes = gzipSync(Buffer.concat(chunks));
  const configBytes = encode(configuration);
  const record = {
    driverId: 'meter', displayName: 'Meter', version, schemaVersion: 1,
    source: { commit: 'a'.repeat(40), directory: 'Drivers/Meter' },
    configuration: { file: 'driver-config.json', sha256: hash(configBytes) },
    image: { archive: 'meter.tar.gz', digest: manifest.digest, platforms: ['linux/amd64'], archiveSha256: hash(bytes) }
  };
  await store.save({ detail: { record, configuration }, manifestBytes: encode(record), configBytes }, Readable.from([bytes]));
  return record;
}

// Just enough of Nomad to stage, change and purge jobs, with Variables.
function fakeNomad() {
  const jobs = new Map();
  const variables = new Map();
  const allocations = new Map();
  let index = 10;
  const request = async (url, init) => {
    const path = url.pathname;
    const method = init.method;
    if (path === '/v1/status/leader') return Response.json('leader');
    if (path === '/v1/jobs' && method === 'GET') {
      return Response.json([...jobs.values()].map(({ ID, Status, JobModifyIndex, Meta }) => ({ ID, Status, JobModifyIndex, Meta })));
    }
    if (path === '/v1/jobs') {
      const { Job, JobModifyIndex } = JSON.parse(init.body);
      if ((jobs.get(Job.ID)?.JobModifyIndex ?? 0) !== JobModifyIndex) return new Response('Enforcing job modify index', { status: 400 });
      jobs.set(Job.ID, { ...Job, JobModifyIndex: ++index, Status: Job.TaskGroups[0].Count ? 'running' : 'dead' });
      return Response.json({ JobModifyIndex: index, EvalID: randomUUID() });
    }
    const variable = /^\/v1\/var\/(.+)$/.exec(path)?.[1];
    if (variable) {
      if (method !== 'GET' && Number(url.searchParams.get('cas') ?? -1) !== (variables.get(variable)?.ModifyIndex ?? 0))
        return Response.json({ Items: { foreign: 'private' } }, { status: 409 });
      if (method === 'PUT') variables.set(variable, { Path: variable, ...JSON.parse(init.body), ModifyIndex: ++index });
      if (method === 'DELETE') return variables.delete(variable) ? new Response('', { status: 200 }) : new Response(null, { status: 404 });
      return variables.has(variable) ? Response.json(variables.get(variable)) : new Response(null, { status: 404 });
    }
    const [, id, part] = /^\/v1\/job\/([^/]+)(?:\/(.+))?$/.exec(path) ?? [];
    if (part === 'plan') return Response.json({ JobModifyIndex: jobs.get(id)?.JobModifyIndex ?? 0 });
    if (method === 'DELETE') {
      assert.equal(url.searchParams.get('purge'), 'true');
      return jobs.delete(id) ? Response.json({ EvalID: randomUUID() }) : new Response(null, { status: 404 });
    }
    if (part === 'allocations') return Response.json(allocations.get(id) ?? []);
    if (part === 'evaluations') return Response.json([]);
    return jobs.has(id) ? Response.json(jobs.get(id)) : new Response(null, { status: 404 });
  };
  return { jobs, variables, allocations, request };
}

test('deployments, VideoIPath tokens and retained releases are removed only when nothing depends on them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'driverhub-removal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ReleaseStore(join(root, 'releases'));
  const images = new Images(join(root, 'images'));
  const labels = await DeploymentLabels.open(join(root, 'labels'));
  const first = await retain(store, '1.0.0');
  await retain(store, '1.1.0');
  await retain(store, '2.0.0');
  const nomad = fakeNomad();
  const site = await Site.open(join(root, 'site'), { nomad: { namespace: 'default', datacenters: ['dc1'] } },
    { client: settings => new Nomad(settings.address, settings.token, settings.namespace, nomad.request) });
  const server = createApi(null, store, { token: 'admin', apiTokens: viewerTokens('reader'), site, images,
    get deployments() { return Deployments.forSite(site, { store, images, labels }); } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (method, path, body, token = 'admin', headers = {}) => {
    const response = await fetch(`${base}${path}`, { method, body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers } });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call('PUT', '/site/nomad', { revision: 0, address: 'nomad.example', token: 'acl' })).status, 200);
  const tokens = [randomUUID(), randomUUID(), randomUUID()];
  assert.equal((await call('PUT', '/site/videoipath', { revision: 1, address: 'vip.example', tokens })).status, 200);
  const stage = async (nodeId, label) => {
    const staged = await call('POST', '/deployments', { driverId: 'meter', version: '1.0.0', label }, 'admin',
      { 'Idempotency-Key': nodeId });
    assert.equal(staged.status, 200, JSON.stringify(staged.body));
    return staged.body.revision;
  };

  // A deployment is deleted only once stopped, and only at the revision the client reviewed.
  const a = randomUUID();
  let revision = await stage(a, 'Meter A');
  revision = (await call('POST', `/deployments/${a}/start`, { revision })).body.revision;
  const running = await call('DELETE', `/deployments/${a}?revision=${revision}`);
  assert.equal(running.status, 409);
  assert.equal(running.body.code, 'deployment_running');
  revision = (await call('POST', `/deployments/${a}/stop`, { revision })).body.revision;
  assert.equal((await call('DELETE', `/deployments/${a}?revision=${revision - 1}`)).body.code, 'revision_conflict');
  assert.equal((await call('DELETE', `/deployments/${a}`)).status, 400);
  assert.equal((await call('DELETE', `/deployments/${a}?revision=${revision}`, undefined, 'reader')).status, 403);
  const registration = `nomad/jobs/driverhub-${a}/device/driver`;
  assert.ok(nomad.variables.has(registration));
  for (const state of ['running', 'pending', 'unknown', 'lost']) {
    nomad.allocations.set(`driverhub-${a}`, [{ DesiredStatus: 'stop', ClientStatus: state }]);
    assert.equal((await call('DELETE', `/deployments/${a}?revision=${revision}`)).body.code, 'allocation_not_stopped');
    assert.ok(nomad.variables.has(registration));
  }
  nomad.allocations.set(`driverhub-${a}`, [{ DesiredStatus: 'stop', ClientStatus: 'complete' }]);
  const deleted = await call('DELETE', `/deployments/${a}?revision=${revision}`);
  assert.deepEqual(deleted.body, { nodeId: a, deleted: true, registrationVariable: 'removed' });
  assert.ok(!nomad.jobs.has(`driverhub-${a}`));
  assert.ok(!nomad.variables.has(registration));
  assert.equal(labels.get(a), null);
  assert.equal((await call('GET', `/deployments/${a}`)).status, 404);

  // Its token stays reserved until removed; tokens of existing deployments cannot be removed.
  const b = randomUUID();
  const bPath = `nomad/jobs/driverhub-${b}/device/driver`;
  nomad.variables.set(bPath, { Path: bPath, Items: { customer: 'preserve' }, ModifyIndex: 2 });
  await stage(b, 'Meter B');
  let pool = site.describe().videoipath.pool;
  const reservedFor = nodeId => pool.find(entry => entry.nodeId === nodeId).tokenFingerprint;
  const unused = pool.find(entry => entry.nodeId === null).tokenFingerprint;
  assert.deepEqual(pool.map(entry => entry.tokenFingerprint).sort(), tokens.map(hash).sort());
  const removeToken = (fingerprint, rev = site.describe().revision) =>
    call('DELETE', `/site/videoipath/tokens/${fingerprint}?revision=${rev}`);
  const inUse = await removeToken(reservedFor(b));
  assert.equal(inUse.status, 409);
  assert.deepEqual([inUse.body.code, inUse.body.details.nodeId], ['token_in_use', b]);
  assert.equal((await removeToken(unused, site.describe().revision - 1)).body.code, 'revision_conflict');
  assert.equal((await removeToken('f'.repeat(64))).status, 404);
  assert.equal((await removeToken(unused)).status, 200);
  const released = await removeToken(reservedFor(a));
  assert.equal(released.status, 200);
  pool = released.body.videoipath.pool;
  assert.deepEqual(pool.map(entry => entry.nodeId), [b]);
  assert.equal(released.body.videoipath.availableTokens, 0);

  // A release is kept while a deployment runs it or can roll back to it.
  const current = await call('DELETE', '/retained/meter/1.0.0');
  assert.equal(current.status, 409);
  assert.deepEqual(current.body.details.deployments, [{ nodeId: b, use: 'current' }]);
  const original = site.state.nomad;
  const switchTarget = address => call('PUT', '/site/nomad', { revision: site.describe().revision, address });
  const parked = new Map(nomad.jobs);
  assert.equal((await switchTarget('https://second.example')).status, 200);
  nomad.jobs.clear(); // The second target has no jobs; the first target still needs the image.
  assert.deepEqual((await call('DELETE', '/retained/meter/1.0.0')).body.details.deployments, [{ nodeId: b, use: 'unconfirmed' }]);
  assert.equal((await switchTarget(original.address)).status, 200);
  for (const [id, job] of parked) nomad.jobs.set(id, job);
  revision = (await call('GET', `/deployments/${b}`)).body.revision;
  revision = (await call('POST', `/deployments/${b}/update`, { revision, version: '1.1.0' })).body.revision;
  assert.deepEqual((await call('DELETE', '/retained/meter/1.0.0')).body.details.deployments, [{ nodeId: b, use: 'previous' }]);
  assert.equal((await call('DELETE', '/retained/meter/2.0.0', undefined, 'reader')).status, 403);
  assert.deepEqual((await call('DELETE', '/retained/meter/2.0.0')).body,
    { driverId: 'meter', version: '2.0.0', removed: true, image: 'none' });
  assert.equal((await call('DELETE', '/retained/meter/2.0.0')).status, 404);

  // Once nothing uses it, the release and its published image both go.
  assert.equal((await call('DELETE', `/deployments/${b}?revision=${revision}`)).status, 200);
  assert.deepEqual(nomad.variables.get(bPath).Items, { customer: 'preserve' });
  await access(join(root, 'images', imageKey(first)));
  assert.deepEqual((await call('DELETE', '/retained/meter/1.0.0')).body,
    { driverId: 'meter', version: '1.0.0', removed: true, image: 'removed' });
  await assert.rejects(access(join(root, 'images', imageKey(first))));
  assert.deepEqual((await call('GET', '/retained')).body.releases.map(r => r.version), ['1.1.0']);
});

test('a staged image remains pullable across simultaneous release removal; purge cannot erase a queued start or restage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'driverhub-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ReleaseStore(join(root, 'releases')), images = new Images(join(root, 'images'));
  const record = await retain(store, '1.0.0');
  const fake = fakeNomad();
  let gate;
  function pause(method) {
    let ready, release;
    const entered = new Promise(r => { ready = r; }), wait = new Promise(r => { release = r; });
    gate = { method, ready, wait };
    return { entered, release };
  }
  const nomad = new Nomad('http://localhost', null, 'default', async (url, init) => {
    if (gate && init.method === gate.method && !url.pathname.endsWith('/plan')) {
      const barrier = gate;
      gate = null;
      barrier.ready();
      await barrier.wait;
    }
    return fake.request(url, init);
  });
  const deployments = new Deployments({ store, images, registry: 'images.local', nomad, datacenters: ['dc1'] });
  const server = createApi(null, store, { deployments, images }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const id = randomUUID(), body = { nodeId: id, driverId: 'meter', version: '1.0.0' };
  const post = (path, data) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const del = path => fetch(base + path, { method: 'DELETE' });
  let barrier = pause('POST');
  const stage = post('/deployments', body);
  await barrier.entered;
  let arrived = once(server, 'request');
  const removal = del('/retained/meter/1.0.0');
  await arrived;
  barrier.release();
  const { revision } = await (await stage).json();
  assert.equal((await (await removal).json()).code, 'release_in_use');
  for (const item of Object.values((await images.info(imageKey(record))).objects))
    await access(join(images.root, imageKey(record), item.file));
  barrier = pause('DELETE');
  const purge = del(`/deployments/${id}?revision=${revision}`);
  await barrier.entered;
  arrived = once(server, 'request');
  const start = post(`/deployments/${id}/start`, { revision, originalStopped: true });
  await arrived;
  const restage = post('/deployments', body);
  barrier.release();
  assert.equal((await purge).status, 200);
  assert.equal((await start).status, 404);
  assert.equal((await restage).status, 200);
  assert.equal(fake.jobs.get(`driverhub-${id}`).TaskGroups[0].Count, 0);
});

test('an ambiguous registration replays after restart and CAS cleanup never deletes a rotated Variable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'driverhub-reconcile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ReleaseStore(join(root, 'releases')), images = new Images(join(root, 'images'));
  await retain(store, '1.0.0');
  const fake = fakeNomad(), id = randomUUID(), token = randomUUID();
  const path = `nomad/jobs/driverhub-${id}/device/driver`;
  let lost = true, rotate = true;
  const client = n => new Nomad(n.address, n.token, n.namespace, async (url, init) => {
    if (init.method === 'DELETE' && url.pathname === `/v1/var/${path}` && rotate) {
      const v = fake.variables.get(path);
      fake.variables.set(path, { ...v, Items: { ...v.Items, customer: 'new' }, ModifyIndex: v.ModifyIndex + 100 });
      rotate = false;
    }
    const response = await fake.request(url, init);
    if (lost && url.pathname === '/v1/jobs' && init.method === 'POST') {
      lost = false;
      throw new Error('response lost after commit');
    }
    return response;
  });
  const open = () => Site.open(join(root, 'site'), { nomad: { address: 'https://nomad.example', namespace: 'default', datacenters: ['dc1'] } },
    { client });
  let site = await open();
  await site.configure('videoipath', { revision: 0, address: 'vip.example', token });
  const manager = () => Deployments.forSite(site, { store, images });
  const stage = () => manager().stage({ driverId: 'meter', version: '1.0.0' }, false, id);
  await assert.rejects(stage, e => e.code === 'nomad_write_unconfirmed');
  site = await open();
  const replay = await stage();
  assert.equal(replay.replayed, true);
  assert.equal(fake.jobs.size, 1);
  const removed = await manager().remove(id, replay.revision);
  assert.equal(removed.registrationVariable, 'failed');
  assert.equal(fake.variables.get(path).Items.customer, 'new');
  site = await open();
  await assert.rejects(stage, e => e.code === 'cleanup_pending');
  assert.equal((await manager().remove(id, replay.revision)).registrationVariable, 'failed');
  // Operator reconciles only the old registration key; the retry keeps the sibling.
  for (const key of Object.keys(fake.variables.get(path).Items))
    if (key.startsWith('vip_')) delete fake.variables.get(path).Items[key];
  assert.equal((await manager().remove(id, replay.revision)).registrationVariable, 'none');
  assert.deepEqual(fake.variables.get(path).Items, { customer: 'new' });
  // An already present, identical credential can be used but is never adopted for deletion.
  const borrowed = `vip_${site.state.videoipath.id}`;
  fake.variables.get(path).Items[borrowed] = token;
  const next = await stage();
  assert.equal((await manager().remove(id, next.revision)).registrationVariable, 'none');
  assert.deepEqual(fake.variables.get(path).Items, { customer: 'new', [borrowed]: token });
});
