import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { Site } from '../src/site.js';
import { DeploymentLabels } from '../src/labels.js';

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

test('post-start site setup assigns separate durable registration tokens without embedding them in jobs', async t => {
  const { root, store, images } = await setup(t);
  await retain(store, '1.0.0');
  const defaults = { namespace: 'default', datacenters: ['dc1'] };
  const dir = join(root, 'site');
  const jobs = new Map();
  const variables = new Map();
  let failNextVariableWrite = false;
  const client = n => new Nomad(n.address, n.token, n.namespace, async (url, req) => {
    assert.equal(url.hostname, 'nomad.example');
    assert.equal(req.headers['X-Nomad-Token'], 'sample-acl');
    const path = url.pathname;
    if (path.endsWith('status/leader')) return Response.json('test-leader');
    if (path.endsWith('/jobs') && req.method === 'GET') return Response.json([]);
    if (path.endsWith('/plan')) return Response.json({ JobModifyIndex: jobs.get(JSON.parse(req.body).Job.ID)?.JobModifyIndex ?? 0 });
    if (path.includes('/var/')) {
      if (req.method === 'PUT') {
        if (failNextVariableWrite) {
          failNextVariableWrite = false;
          return new Response(null, { status: 503 });
        }
        variables.set(path, { ...JSON.parse(req.body), ModifyIndex: 1 });
      }
      return variables.has(path) ? Response.json(variables.get(path)) : new Response(null, { status: 404 });
    }
    if (path === '/v1/jobs') {
      const { Job, JobModifyIndex } = JSON.parse(req.body);
      jobs.set(Job.ID, { ...Job, JobModifyIndex: JobModifyIndex + 1 });
      return Response.json({ JobModifyIndex: JobModifyIndex + 1, EvalID: randomUUID() });
    }
    const job = jobs.get(path.split('/').at(-1));
    return job ? Response.json(job) : new Response(null, { status: 404 });
  });
  let site = await Site.open(dir, defaults, { client });
  const base = `${await listen(t, createApi(null, store, { token: 'admin', viewerToken: 'reader',
    get site() { return site; }, get deployments() {
      return Deployments.forSite(site, { store, images, registry: 'images.internal' });
    }
  }))}/api/v1`;
  const headers = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };
  const put = (part, body) => fetch(`${base}/site/${part}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/site`, { headers: { Authorization: 'Bearer reader' } })).status, 403);
  assert.equal((await put('nomad', { revision: 0, address: 'nomad.example', token: 'sample-acl' })).status, 200);
  const values = [randomUUID(), randomUUID()];
  const vip = { revision: 1, address: 'vip.example', tokens: values };
  const result = await put('videoipath', vip);
  assert.equal(result.status, 200);
  const view = await result.json();
  assert.equal(view.videoipath.url, 'wss://vip.example/x-driver/v1');
  assert.equal(view.videoipath.availableTokens, 2);
  assert.equal((await put('videoipath', vip)).status, 409);
  const nodes = [randomUUID(), randomUUID()];
  const formRequest = await fetch(`${base}/retained/meter/1.0.0/deploy-form`, {
    method: 'POST', headers, body: JSON.stringify({ settings: { credential: { secretRef: 'device_key' } } })
  });
  assert.equal(formRequest.status, 200);
  const form = await formRequest.json();
  assert.deepEqual(form.validation, { valid: true, errors: [] });
  assert.deepEqual(form.fields.filter(f => f.source === 'site').map(f => f.env), ['VIDEOIPATH_URL', 'VIDEOIPATH_TOKEN']);
  assert.equal(site.describe().revision, view.revision);
  assert.equal(jobs.size, 0);
  assert.equal(variables.size, 0);
  const stage = (node, dry = false) => fetch(`${base}/deployments?dryRun=${dry}`, { method: 'POST',
    headers: { ...headers, 'Idempotency-Key': node }, body: JSON.stringify({ driverId: 'meter', version: '1.0.0',
      settings: { credential: { secretRef: 'device_key' } } }) });
  const invalidInput = { settings: { credential: { secretRef: 'not/a/key' } } };
  const invalidForm = await fetch(`${base}/retained/meter/1.0.0/deploy-form`, {
    method: 'POST', headers, body: JSON.stringify(invalidInput)
  });
  const invalidPlan = await fetch(`${base}/deployments?dryRun=true`, { method: 'POST', headers,
    body: JSON.stringify({ driverId: 'meter', version: '1.0.0', ...invalidInput }) });
  assert.equal(invalidPlan.status, 422);
  assert.deepEqual((await invalidPlan.json()).details.fields, (await invalidForm.json()).validation.errors);
  assert.equal((await stage(nodes[0], true)).status, 200);
  assert.equal(variables.size, 0);
  assert.equal(site.describe().videoipath.availableTokens, 2);
  for (const response of await Promise.all(nodes.map(node => stage(node)))) assert.equal(response.status, 200);
  assert.equal(site.describe().videoipath.availableTokens, 0);
  const delivered = [...variables.values()].map(variable => Object.values(variable.Items)[0]);
  assert.deepEqual(delivered.sort(), [...values].sort());
  for (const [path] of variables) assert.match(path, /\/driverhub-[0-9a-f-]+\/device\/driver$/);
  for (const job of jobs.values()) {
    const template = job.TaskGroups[0].Tasks[0].Templates.map(t => t.EmbeddedTmpl).join('\n');
    assert.ok(template.includes(`nomad/jobs/${job.ID}/device/driver`));
    assert.match(template, /VIDEOIPATH_URL=.*wss:\/\/vip.example\/x-driver\/v1/);
    assert.match(template, /VIDEOIPATH_TOKEN=.*nomadVar/);
  }
  site = await Site.open(dir, defaults, { client });
  assert.equal((await (await stage(nodes[0])).json()).replayed, true);
  const exhausted = await stage(randomUUID());
  assert.equal((await exhausted.json()).code, 'driver_token_pool_empty');
  const encrypted = await readFile(join(dir, 'site.enc'));
  for (const secret of ['sample-acl', ...values]) {
    assert.ok(!encrypted.includes(secret));
    assert.ok(!JSON.stringify([view, site.describe(), ...jobs.values()]).includes(secret));
  }
  const rev = site.describe().revision;
  assert.equal((await put('videoipath', { revision: rev, address: vip.address, tokenMode: 'shared', token: values[0] })).status, 409);
  const extra = randomUUID();
  assert.equal((await put('videoipath', { revision: rev, address: vip.address, token: extra })).status, 200);
  const retryNode = randomUUID();
  failNextVariableWrite = true;
  assert.equal((await stage(retryNode)).status, 502);
  assert.equal(site.describe().videoipath.availableTokens, 0);
  assert.equal((await stage(retryNode)).status, 200);
  assert.deepEqual(Object.values(variables.get(`/v1/var/nomad/jobs/driverhub-${retryNode}/device/driver`).Items), [extra]);
  assert.equal((await put('videoipath', { revision: site.describe().revision, address: 'next.site', tokenMode: 'shared', token: 'shared-example' })).status, 200);
  const start = await fetch(`${base}/deployments/${retryNode}/start`, { method: 'POST', headers, body: '{"revision":1}' });
  assert.equal(start.status, 200);
  assert.equal(JSON.parse(jobs.get(`driverhub-${retryNode}`).Meta.spec).videoIPath.url, view.videoipath.url);
  assert.equal(variables.size, 3);
  assert.equal((await stage(randomUUID())).status, 200);
  assert.equal((await stage(randomUUID())).status, 200);
});

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
  await rm(join(root, 'images', key, record.image.digest.slice(7)));
  assert.equal((await fetch(`${base}/manifests/${record.image.digest}`, { method: 'HEAD' })).status, 404);
  await assert.rejects(images.publish(record, store.archivePath('meter', record.version)), /incomplete/);
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

test('new-device staging with a request key survives retries without triggering migration or reverting updates', async t => {
  const { store, images } = await setup(t);
  await retain(store, '1.0.0');
  await retain(store, '2.0.0');
  let job;
  let submissions = 0;
  const nomad = new Nomad('http://test.invalid', null, 'default', async (url, req) => {
    if (url.pathname.endsWith('/plan')) return Response.json({ JobModifyIndex: submissions });
    if (url.pathname === '/v1/jobs') {
      const { JobModifyIndex, Job } = JSON.parse(req.body);
      if (JobModifyIndex !== submissions) return new Response(null, { status: 409 });
      job = { ...Job, JobModifyIndex: ++submissions };
      return Response.json({ JobModifyIndex: submissions, EvalID: 'eval' });
    }
    return job ? Response.json(job) : new Response(null, { status: 404 });
  });
  const labels = await DeploymentLabels.open(join(store.root, '..', 'labels'));
  const deployments = new Deployments({ store, images, nomad, registry: 'images.internal', datacenters: ['dc1'], labels });
  const base = `${await listen(t, createApi(null, store, { deployments }))}/api/v1/deployments`;
  const input = { driverId: 'meter', version: '1.0.0', settings: { credential: { secretRef: 'key' } }, label: 'Meter A' };
  const stage = body => fetch(base, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'Idempotency-Key': nodeId
  }, body: JSON.stringify(body) });
  const invalid = await stage({ ...input, label: '' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'invalid_label');
  assert.equal(submissions, 0);
  const attempts = await Promise.all([stage(input), stage(input)]);
  assert.deepEqual(attempts.map(r => r.status), [200, 200]);
  assert.equal(submissions, 1);
  assert.equal(job.Meta.migrated, 'false');
  assert.equal(labels.get(nodeId), 'Meter A');
  assert.ok(!JSON.stringify(job).includes('Meter A'));
  await deployments.change(nodeId, 'update', { revision: 1, version: '2.0.0' });
  const replay = await (await stage({ ...input, label: 'Meter B' })).json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision, 2);
  assert.equal(labels.get(nodeId), 'Meter B');
  assert.equal((await stage({ ...input, version: '2.0.0' })).status, 409);
  assert.equal(submissions, 2);
});

test('migration, guarded start, update, rollback and stop use one stable Nomad job', async t => {
  const { store, images } = await setup(t);
  await retain(store, '1.0.0');
  await retain(store, '2.0.0');
  let job;
  let observedAt = Math.floor(Date.now() / 1000);
  const nomad = new Nomad('http://nomad.invalid', null, 'default', async (url, request) => {
    if (url.pathname.endsWith('/plan')) return Response.json({ FailedTGAllocs: {}, JobModifyIndex: job?.JobModifyIndex ?? 0 });
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
  const migration = { nodeId, driverId: 'meter', version: '1.0.0', settings: { credential: { secretRef: 'key' } } };
  const planned = await (await post('?dryRun=true', migration)).json();
  assert.equal(planned.preview, true);
  assert.equal(planned.schedulable, true);
  assert.equal(planned.requested, 'stopped');
  assert.equal(job, undefined);
  await assert.rejects(access(images.root), { code: 'ENOENT' });
  const stage = await post('', migration);
  assert.equal(stage.status, 200);
  assert.equal(job.TaskGroups[0].Count, 0);
  const start = `/${nodeId}/start`;
  assert.equal((await (await post(`${start}?dryRun=true`, { revision: 1 })).json()).requested, 'running');
  assert.equal(job.TaskGroups[0].Count, 0);
  assert.equal((await post(start, { revision: 1 })).status, 409);
  assert.equal((await post(start, { revision: 1, originalStopped: true })).status, 200);
  const original = job.TaskGroups[0].Tasks[0].Config.image;
  assert.equal(job.TaskGroups[0].Count, 1);
  assert.equal((await (await fetch(`${base}/${nodeId}`)).json()).communication, 'driver-reports-connected');
  observedAt -= 60;
  assert.equal((await (await fetch(`${base}/${nodeId}`)).json()).communication, 'unknown');
  const update = `/${nodeId}/update`;
  assert.equal((await post(update, { revision: 1, version: '2.0.0' })).status, 409);
  const invalid = await post(update, { revision: 2, version: '2.0.0', settings: {} });
  assert.equal(invalid.status, 422);
  assert.deepEqual((await invalid.json()).details.fields, [{ field: 'credential', code: 'required' }]);
  job.Stop = true; // An operator ran `nomad job stop`, leaving Count=1.
  assert.equal((await (await fetch(`${base}/${nodeId}`)).json()).requested, 'stopped');
  assert.equal((await (await post(`${update}?dryRun=true`, { revision: 2, version: '2.0.0' })).json()).requested, 'stopped');
  assert.equal((await post(update, { revision: 2, version: '2.0.0' })).status, 200);
  assert.notEqual(job.TaskGroups[0].Tasks[0].Config.image, original);
  assert.equal(job.TaskGroups[0].Count, 0);
  assert.equal((await (await post(update, { revision: 3, version: '2.0.0' })).json()).unchanged, true);
  assert.equal((await post(`/${nodeId}/rollback`, { revision: 3 })).status, 200);
  assert.equal(job.TaskGroups[0].Tasks[0].Config.image, original);
  assert.equal(job.TaskGroups[0].Count, 0);
  assert.equal(job.TaskGroups[0].Tasks[0].Env.VIDEOIPATH_NODE_ID, nodeId);
  assert.equal((await post(`/${nodeId}/stop`, { revision: 4 })).status, 200);
  assert.equal(job.TaskGroups[0].Count, 0);
});
