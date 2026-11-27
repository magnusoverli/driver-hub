import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { get } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { createApi } from '../src/http.js';
import { Deployments } from '../src/deployments.js';
import { DeploymentLabels } from '../src/labels.js';
import { Nomad } from '../src/nomad.js';
import { WebApp } from '../src/web.js';
import { apiContract } from '../src/openapi.js';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];

async function temporary(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function job(nodeId, { count = 1, health = true, migrated = false, version = 3 } = {}) {
  const task = { Name: 'driver', Driver: 'docker', Config: { image: `images.internal/driverhub/meter@sha256:${'a'.repeat(64)}` } };
  if (health) task.Services = [{ Name: `driverhub-${nodeId}` }];
  return {
    ID: `driverhub-${nodeId}`, Status: count ? 'running' : 'dead', JobModifyIndex: 40 + version, Version: version,
    Meta: { managed_by: 'driver-hub', migrated: String(migrated), previous: 'null',
      spec: JSON.stringify({ nodeId, driverId: 'meter', version: '1.0.0', settings: {} }) },
    TaskGroups: [{ Name: 'device', Count: count, Tasks: [task] }]
  };
}

function fakeNomad(jobs, { failing = new Set(), allocations = {}, checks = {} } = {}) {
  return new Nomad('http://nomad.invalid', null, 'default', async url => {
    const path = url.pathname;
    if (path === '/v1/jobs') {
      return Response.json([...jobs.values()].map(({ TaskGroups, ...stub }) => stub).concat({ ID: 'other', Meta: {} }));
    }
    const id = /^\/v1\/job\/([^/]+)/.exec(path)?.[1];
    if (id && failing.has(id)) return new Response('unavailable', { status: 500 });
    if (path.endsWith('/allocations')) return Response.json(allocations[id] ?? []);
    const alloc = /^\/v1\/client\/allocation\/([^/]+)\/checks$/.exec(path)?.[1];
    if (alloc) return Response.json(checks[alloc] ?? {});
    return jobs.has(id) ? Response.json(jobs.get(id)) : new Response(null, { status: 404 });
  });
}

test('deployment list reports labels, requested state, evidence and the current allocation per device', async t => {
  const labels = await DeploymentLabels.open(await temporary(t, 'driverhub-labels-'));
  await labels.set(ids[0], 'Studio 3 meter');
  const jobs = new Map([[`driverhub-${ids[0]}`, job(ids[0])], [`driverhub-${ids[1]}`, job(ids[1], { count: 0, migrated: true })],
    [`driverhub-${ids[2]}`, job(ids[2])]]);
  const now = Math.floor(Date.now() / 1000);
  const nomad = fakeNomad(jobs, {
    failing: new Set([`driverhub-${ids[2]}`]),
    allocations: { [`driverhub-${ids[0]}`]: [
      { ID: 'old', NodeName: 'client-1', DesiredStatus: 'stop', ClientStatus: 'complete', JobVersion: 2, CreateIndex: 1 },
      { ID: 'current', NodeName: 'client-3', DesiredStatus: 'run', ClientStatus: 'running', JobVersion: 3, CreateIndex: 9,
        TaskStates: { driver: { State: 'running', Restarts: 2 } } }
    ] },
    checks: { current: { c: { Check: 'driver-communication', Task: 'driver', Status: 'failure', Timestamp: now } } }
  });
  const deployments = new Deployments({ nomad, labels, datacenters: ['dc1'] });
  const base = await listen(t, createApi(null, null, { deployments }));
  const response = await fetch(`${base}/api/v1/deployments`);
  assert.equal(response.status, 200);
  const rows = new Map((await response.json()).deployments.map(row => [row.nodeId, row]));
  assert.equal(rows.size, 3);
  assert.deepEqual(rows.get(ids[0]), {
    nodeId: ids[0], driverId: 'meter', version: '1.0.0', label: 'Studio 3 meter', status: 'running', revision: 43,
    requested: 'running', requiresOriginalStopped: false, communication: 'check-failed', approval: 'unknown',
    communicationEvidence: { state: 'check-failed', reason: 'fresh_observation', allocationId: 'current',
      observedAt: new Date(now * 1000).toISOString() },
    allocation: { id: 'current', host: 'client-3', desired: 'run', status: 'running', jobVersion: 3, taskState: 'running', restarts: 2 }
  });
  const stopped = rows.get(ids[1]);
  assert.equal(stopped.label, null);
  assert.equal(stopped.requested, 'stopped');
  assert.equal(stopped.requiresOriginalStopped, true);
  assert.equal(stopped.communicationEvidence.reason, 'stopped');
  assert.equal(stopped.allocation, null);
  const unreachable = rows.get(ids[2]);
  assert.equal(unreachable.requested, null);
  assert.equal(unreachable.communication, 'unknown');
  assert.equal(unreachable.communicationEvidence.reason, 'status_unavailable');
  const detail = await (await fetch(`${base}/api/v1/deployments/${ids[0]}`)).json();
  assert.equal(detail.label, 'Studio 3 meter');
  assert.equal(detail.allocations.length, 2);
  assert.equal(detail.inheritsSite, false);
});

test('deployment detail says whether the device takes its VideoIPath target from the site', async t => {
  const site = job(ids[1]);
  const spec = JSON.parse(site.Meta.spec);
  site.Meta.spec = JSON.stringify({ ...spec, videoIPath: { id: 'p1', url: 'wss://vip.site/x-driver/v1', mode: 'per-device' } });
  const jobs = new Map([[`driverhub-${ids[0]}`, job(ids[0])], [`driverhub-${ids[1]}`, site]]);
  const deployments = new Deployments({ nomad: fakeNomad(jobs), datacenters: ['dc1'] });
  const base = await listen(t, createApi(null, null, { deployments }));
  const detail = async nodeId => (await fetch(`${base}/api/v1/deployments/${nodeId}`)).json();
  assert.equal((await detail(ids[0])).inheritsSite, false);
  assert.equal((await detail(ids[1])).inheritsSite, true);
});

test('ten fleet readers share one 100-job hydration, with fresh monitoring independent of write preconditions', async t => {
  const rows = Array.from({ length: 100 }, () => job(randomUUID()));
  const jobs = new Map(rows.map(row => [row.ID, row]));
  const allocations = Object.fromEntries(rows.map(row => [row.ID, [{
    ID: row.ID, JobVersion: row.Version, DesiredStatus: 'run', ClientStatus: 'running'
  }]]));
  const nomad = fakeNomad(jobs, { allocations });
  const upstream = nomad.request;
  let calls = 0, release;
  const wait = new Promise(r => { release = r; });
  nomad.request = async (...args) => { calls++; await wait; return upstream(...args); };
  const deployments = new Deployments({ nomad });
  const server = createApi(null, null, { deployments, timings: true });
  const base = await listen(t, server);
  let arrivals = 0;
  server.on('request', () => { if (++arrivals === 10) release(); });
  const fleet = () => fetch(`${base}/api/v1/deployments`);
  const results = await Promise.all(Array.from({ length: 10 }, fleet));
  for (const response of results) assert.equal((await response.json()).deployments.length, 100);
  assert.equal(calls, 301);
  assert.ok(results.some(r => /301 calls/.test(r.headers.get('server-timing'))));
  rows[0].Meta.spec = 'invalid JSON';
  assert.equal((await fetch(`${base}/api/v1/deployments/${rows[0].ID.slice(10)}`)).status, 409);
  assert.equal((await deployments.overview()).filter(r => r.communicationEvidence.reason === 'job_drift').length, 1);
});

test('admins rename deployments without touching Nomad; labels are validated, durable and admin-only', async t => {
  const directory = await temporary(t, 'driverhub-labels-');
  const labels = await DeploymentLabels.open(directory);
  const jobs = new Map([[`driverhub-${ids[0]}`, job(ids[0])]]);
  const writes = [];
  const nomad = fakeNomad(jobs);
  const request = nomad.request;
  nomad.request = async (url, init) => {
    if (init.method !== 'GET') writes.push(url.pathname);
    return request(url, init);
  };
  const admin = randomUUID();
  const viewer = randomUUID();
  const deployments = new Deployments({ nomad, labels, datacenters: ['dc1'] });
  const base = await listen(t, createApi(null, null, { deployments, token: admin, viewerToken: viewer }));
  const rename = (nodeId, body, token = admin) => fetch(`${base}/api/v1/deployments/${nodeId}/label`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body)
  });
  const renamed = await rename(ids[0], { label: '  Studio 3 meter  ' });
  assert.equal(renamed.status, 200);
  assert.deepEqual(await renamed.json(), { nodeId: ids[0], label: 'Studio 3 meter' });
  for (const label of ['', ' ', 'x'.repeat(81), 'tab\tseparated', 42]) {
    const invalid = await rename(ids[0], { label });
    assert.equal(invalid.status, 400, JSON.stringify(label));
    assert.equal((await invalid.json()).code, 'invalid_label');
  }
  assert.equal((await rename(ids[0], {})).status, 400);
  assert.equal((await rename(ids[1], { label: 'Missing' })).status, 404);
  const forbidden = await rename(ids[0], { label: 'Viewer' }, viewer);
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, 'admin_required');
  assert.equal((await DeploymentLabels.open(directory)).get(ids[0]), 'Studio 3 meter');
  assert.deepEqual(await (await rename(ids[0], { label: null })).json(), { nodeId: ids[0], label: null });
  assert.equal((await DeploymentLabels.open(directory)).get(ids[0]), null);
  assert.deepEqual(writes, []);
});

test('concurrent label writes are serialized and a corrupt label store is refused at startup', async t => {
  const directory = await temporary(t, 'driverhub-labels-');
  const labels = await DeploymentLabels.open(directory);
  await Promise.all(ids.map((id, index) => labels.set(id, `Device ${index}`)));
  const reopened = await DeploymentLabels.open(directory);
  assert.deepEqual(ids.map(id => reopened.get(id)), ['Device 0', 'Device 1', 'Device 2']);
  await writeFile(join(directory, 'labels.json'), JSON.stringify({ version: 1, labels: { 'not-a-uuid': 'x' } }));
  await assert.rejects(DeploymentLabels.open(directory), /Invalid deployment label record/);
});

test('the contract describes list summaries, labels and the rename route', () => {
  const { schemas } = apiContract.components;
  assert.equal(apiContract.paths['/deployments'].get.responses[200].content['application/json'].schema
    .properties.deployments.items.$ref, '#/components/schemas/DeploymentSummary');
  assert.ok(schemas.DeploymentSummary.required.includes('communication'));
  assert.ok(schemas.Deployment.required.includes('label'));
  assert.ok(!schemas.Stage.required.includes('label'));
  assert.ok(apiContract.paths['/deployments/{nodeId}/label'].put);
});

async function webRoot(t) {
  const root = await temporary(t, 'driverhub-web-');
  const bootstrap = 'import("/_app/immutable/entry/start.js")';
  await mkdir(join(root, '_app', 'immutable', 'entry'), { recursive: true });
  await writeFile(join(root, 'index.html'), `<!doctype html><html><head><script>${bootstrap}</script></head><body></body></html>`);
  const script = 'export const start = 1;';
  await writeFile(join(root, '_app', 'immutable', 'entry', 'start.js'), script);
  await writeFile(join(root, '_app', 'immutable', 'entry', 'start.js.br'), brotliCompressSync(script));
  await writeFile(join(root, '.env'), 'SECRET=1');
  return { root, bootstrap, script };
}

test('the manager serves the frontend shell, hashed assets and API from one origin', async t => {
  const { root, bootstrap, script } = await webRoot(t);
  const web = await WebApp.open(root);
  const base = await listen(t, createApi(null, null, { web, token: randomUUID() }));

  const shell = await fetch(`${base}/deployments/abc`);
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get('content-type'), /^text\/html/);
  assert.equal(shell.headers.get('cache-control'), 'no-cache');
  const policy = shell.headers.get('content-security-policy');
  const hash = createHash('sha256').update(bootstrap).digest('base64');
  assert.match(policy, new RegExp(`script-src 'self' 'sha256-${hash.replace(/[+/]/g, '\\$&')}'`));
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(await shell.text(), /<!doctype html>/);

  const asset = await fetch(`${base}/_app/immutable/entry/start.js`, { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.match(asset.headers.get('content-type'), /^text\/javascript/);
  assert.equal(asset.headers.get('content-security-policy'), null);
  assert.equal(await asset.text(), script);
  const etag = asset.headers.get('etag');
  assert.equal((await fetch(`${base}/_app/immutable/entry/start.js`, { headers: { 'Accept-Encoding': 'identity', 'If-None-Match': etag } })).status, 304);

  // Unlike fetch, a raw request keeps the path exactly as written, including dot segments.
  const raw = (path, headers = {}) => new Promise((resolve, reject) => {
    const { port } = new URL(base);
    get({ host: '127.0.0.1', port, path, headers }, response => { response.resume(); resolve(response); }).on('error', reject);
  });
  assert.equal((await raw('/_app/immutable/entry/start.js', { 'Accept-Encoding': 'gzip, br' })).headers['content-encoding'], 'br');
  assert.equal((await fetch(`${base}/_app/immutable/missing.js`)).status, 404);
  // A release version is a route, not a file extension.
  const release = await fetch(`${base}/catalog/meter/1.4.0`);
  assert.equal(release.status, 200);
  assert.match(release.headers.get('content-type'), /^text\/html/);
  for (const path of ['/.env', '/../../.env', '/%2e%2e/%2e%2e/.env', '/_app/%2e%2e/.env', '/a%00b', '/%E0%A4%A']) {
    assert.equal((await raw(path)).statusCode, 400, path);
  }
  const escaped = await raw('/../../../../etc/hostname');
  assert.match(escaped.headers['content-type'], /^text\/html/);
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
  const head = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const api = await fetch(`${base}/api/v1/capabilities`);
  assert.equal(api.status, 401);
  assert.match(api.headers.get('content-type'), /^application\/json/);
  assert.equal((await fetch(`${base}/api`)).status, 401);
});

test('without a frontend build the manager keeps answering every path as API', async t => {
  assert.equal(await WebApp.open(join(tmpdir(), `missing-${randomUUID()}`)), null);
  const base = await listen(t, createApi(null, null, { token: randomUUID() }));
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('content-type'), /^application\/json/);
});
