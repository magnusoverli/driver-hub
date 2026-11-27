import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { distributionServer, imageHandler } from '../src/distribution.js';
import { ImageCopies, parseWanted } from '../src/image-copies.js';
import {
  IMAGE_HOST, IMAGE_JOB, IMAGE_VARIABLE, ImageDistribution, imageServiceJob, packageRoute, prunePackages, readPackages,
  setupDownloadHost, sourceUrl
} from '../src/image-distribution.js';
import { Images } from '../src/images.js';
import { Deployments } from '../src/deployments.js';
import { Site } from '../src/site.js';
import { createJob } from '../src/job.js';
import { createServer, request } from 'node:http';
import { createApi } from '../src/http.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value));

async function ociArchive(content) {
  const pack = tar.pack();
  const blob = (mediaType, bytes) => {
    pack.entry({ name: `blobs/sha256/${hash(bytes)}` }, bytes);
    return { mediaType, digest: `sha256:${hash(bytes)}`, size: bytes.length };
  };
  const type = 'application/vnd.oci.image.';
  const config = blob(`${type}config.v1+json`, encode({ os: 'linux', architecture: 'amd64' }));
  const layer = blob(`${type}layer.v1.tar`, Buffer.from(content));
  const manifest = blob(`${type}manifest.v1+json`, encode({ schemaVersion: 2, config, layers: [layer] }));
  pack.entry({ name: 'index.json' }, encode({ schemaVersion: 2, manifests: [manifest] }));
  pack.entry({ name: 'oci-layout' }, encode({ imageLayoutVersion: '1.0.0' }));
  pack.finalize();
  const chunks = [];
  for await (const chunk of pack) chunks.push(chunk);
  return { bytes: gzipSync(Buffer.concat(chunks)), manifest, layer };
}

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'driverhub-images-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

// A published image in a store, as the manager has it after staging a device.
async function published(root, version) {
  const { bytes, manifest, layer } = await ociArchive(`layer of ${version}`);
  const file = join(root, `${version}.tar.gz`);
  await writeFile(file, bytes);
  const images = new Images(join(root, 'store'));
  const record = { driverId: 'meter', version, image: { digest: manifest.digest, platforms: ['linux/amd64'] } };
  const key = await images.publish(record, file);
  return { images, key, digest: manifest.digest, layer };
}

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('a copy is fetched whole, checked against its digests, and served like the original', async t => {
  const root = await temporary(t);
  const source = await published(root, '1.0.0');
  const manager = await listen(t, distributionServer(source.images));
  const copies = new ImageCopies(new Images(join(root, 'copies')));

  assert.equal(await copies.copy(source.key, source.digest, ['http://127.0.0.1:1', manager]), true);
  const copy = await listen(t, distributionServer(copies.images));
  const manifest = await fetch(`${copy}/v2/driverhub/${source.key}/manifests/${source.digest}`);
  assert.equal(`sha256:${hash(Buffer.from(await manifest.arrayBuffer()))}`, source.digest);
  assert.equal((await fetch(`${copy}/v2/driverhub/${source.key}/blobs/${source.layer.digest}`)).status, 200);

  // A source cannot hand over another image under a listed key.
  const other = new ImageCopies(new Images(join(root, 'other')));
  assert.equal(await other.copy(source.key, `sha256:${'b'.repeat(64)}`, [manager]), false);
  assert.deepEqual(await readdir(join(root, 'other')), []);
});

test('a source serving altered bytes is skipped for the next one, and leaves nothing behind', async t => {
  const root = await temporary(t);
  const source = await published(root, '1.0.0');
  const honest = await listen(t, distributionServer(source.images));
  const tampering = await listen(t, createServer((req, res) => {
    if (req.url.includes('/blobs/')) return res.writeHead(200).end('not the layer');
    return imageHandler(source.images)(req, res);
  }));
  const copies = new ImageCopies(new Images(join(root, 'copies')));
  assert.equal(await copies.copy(source.key, source.digest, [tampering]), false);
  assert.deepEqual(await readdir(join(root, 'copies')), []);
  assert.equal(await copies.copy(source.key, source.digest, [tampering, honest]), true);
});

test('syncing fetches listed images, keeps fetching from peers while the manager is down, and drops unlisted ones', async t => {
  const root = await temporary(t);
  const first = await published(root, '1.0.0');
  const peerImages = new Images(join(root, 'peer'));
  const peer = new ImageCopies(peerImages);
  const manager = await listen(t, distributionServer(first.images));
  const wanted = { images: [{ key: first.key, digest: first.digest }], sources: [manager] };
  assert.deepEqual(await peer.sync(wanted), { missing: 0 });

  // The manager is gone; a new client copies from the peer instead.
  const fresh = new ImageCopies(new Images(join(root, 'fresh')), { grace: 0 });
  const peerUrl = await listen(t, distributionServer(peerImages));
  assert.deepEqual(await fresh.sync({ images: wanted.images, sources: ['http://127.0.0.1:1', peerUrl] }), { missing: 0 });

  assert.deepEqual(await fresh.sync({ images: [], sources: [] }), { missing: 0 });
  assert.deepEqual(await readdir(join(root, 'fresh')), []);
  assert.deepEqual(await fresh.sync({ images: wanted.images, sources: ['http://127.0.0.1:1'] }), { missing: 1 });
});

test('a pull for an image not copied yet fetches it first, so a driver can start right after staging', async t => {
  const root = await temporary(t);
  const source = await published(root, '1.0.0');
  const manager = await listen(t, distributionServer(source.images));
  const copies = new ImageCopies(new Images(join(root, 'copies')));
  const copy = await listen(t, distributionServer(copies.images, {
    fetchMissing: key => copies.copy(key, source.digest, [manager])
  }));
  const pulled = await fetch(`${copy}/v2/driverhub/${source.key}/manifests/${source.digest}`);
  assert.equal(pulled.status, 200);
});

test('a pull for an image Hub has not listed yet is fetched by its root digest and kept a while', async t => {
  const root = await temporary(t);
  const source = await published(root, '1.0.0');
  const manager = await listen(t, distributionServer(source.images));
  const copies = new ImageCopies(new Images(join(root, 'copies')));
  const stale = { images: [], sources: [manager] };
  const copy = await listen(t, distributionServer(copies.images, {
    fetchMissing: (key, digest, kind) => copies.onDemand(stale, key, digest, kind)
  }));
  // A blob is never the first request of a pull, so it does not start a copy.
  assert.equal((await fetch(`${copy}/v2/driverhub/${source.key}/blobs/${source.layer.digest}`)).status, 404);
  assert.equal((await fetch(`${copy}/v2/driverhub/${source.key}/manifests/${source.digest}`, { method: 'HEAD' })).status, 200);
  assert.equal(await copies.onDemand(null, source.key, source.digest, 'manifests'), false);

  // The next round with the old list keeps the fresh copy; a long-unlisted one goes.
  await copies.sync(stale);
  assert.deepEqual(await readdir(join(root, 'copies')), [source.key]);
  copies.grace = 0;
  await new Promise(resolve => setTimeout(resolve, 5));
  await copies.sync(stale);
  assert.deepEqual(await readdir(join(root, 'copies')), []);
});

test('the list the manager writes is read defensively', () => {
  assert.equal(parseWanted('not json'), null);
  assert.deepEqual(parseWanted(JSON.stringify({ images: [{ key: 'x', digest: 'y' }], sources: ['ftp://a', 'http://10.0.0.5:5481'] })),
    { images: [], sources: ['http://10.0.0.5:5481'] });
});

function fakeNomad({ services = [], allocations = [], checks = {} } = {}) {
  const calls = [];
  let job = null, variable = null;
  return {
    calls, address: 'https://nomad.site.example:4646', namespace: 'driverhub',
    get job() { return job; },
    async services(name) { calls.push(['services', name]); return services; },
    async variable(path) { calls.push(['variable', path]); return variable; },
    async putVariable(path, items) { calls.push(['putVariable', path]); variable = { Path: path, Items: items }; return variable; },
    async get(id) { calls.push(['get', id]); return job; },
    async register(value) { calls.push(['register', value.ID]); job = value; return { EvalID: 'e' }; },
    async allocations() { return allocations; },
    async checks(id) { return checks[id] ?? null; }
  };
}

const pkg = { tag: 'driverhub/image-service:0123456789abcdef', arch: 'amd64', sha256: 'c'.repeat(64), file: '' };

test('setting up Nomad starts the image service on the clients, with its list written first', async t => {
  const root = await temporary(t);
  const source = await published(root, '1.0.0');
  const nomad = fakeNomad({ services: [{ Address: '10.0.0.7', Port: 5480 }, { Address: '10.0.0.8', Port: 5480 }] });
  const site = { state: { nomad: { address: nomad.address, namespace: 'driverhub', datacenters: ['dc1', 'dc2'],
    distributionAddress: '10.0.0.5' } },
    client: () => nomad };
  const distribution = new ImageDistribution({ images: source.images, site, packages: [pkg], port: 5481 });
  await distribution.reconcile();

  assert.deepEqual(nomad.calls.map(c => c[0]).filter(c => ['putVariable', 'register'].includes(c)), ['putVariable', 'register']);
  const job = nomad.job;
  assert.equal(job.ID, IMAGE_JOB);
  assert.equal(job.Type, 'system');
  assert.deepEqual(job.Datacenters, ['dc1', 'dc2']);
  const task = job.TaskGroups[0].Tasks[0];
  const filename = `image-service-${pkg.sha256}.tar.gz`;
  assert.equal(task.Artifacts[0].GetterSource, `http://10.0.0.5:5481/_hub/${filename}`);
  assert.deepEqual(task.Artifacts[0].GetterOptions, { checksum: `sha256:${'c'.repeat(64)}`, archive: 'false' });
  assert.equal(task.Config.load, filename);
  assert.equal(task.Env.DRIVER_HUB_PACKAGE_FILE, filename);
  assert.equal(task.Config.image, pkg.tag);
  assert.equal(task.Config.network_mode, 'host');
  assert.deepEqual(task.Config.cap_drop, ['all']);
  assert.match(task.Templates[0].EmbeddedTmpl, new RegExp(`nomadVar "${IMAGE_VARIABLE}"`));
  assert.deepEqual(job.TaskGroups[0].Networks[0].ReservedPorts, [{ Label: 'http', Value: 5480 }]);

  const wanted = JSON.parse((await nomad.variable(IMAGE_VARIABLE)).Items.wanted);
  assert.deepEqual(wanted.images, [{ key: source.key, digest: source.digest }]);
  assert.deepEqual(wanted.sources, ['http://10.0.0.5:5481', 'http://10.0.0.7:5480', 'http://10.0.0.8:5480']);

  // Nothing changed: the job is not registered again, so the copies keep running.
  nomad.calls.length = 0;
  await distribution.reconcile();
  assert.deepEqual(nomad.calls.filter(c => ['putVariable', 'register'].includes(c[0])), []);
});

test('the Hub setup host excludes the UI port and client-local addresses', () => {
  assert.equal(setupDownloadHost('hub.site.example:8080'), 'hub.site.example');
  assert.equal(setupDownloadHost('172.20.1.4:8080'), '172.20.1.4');
  assert.equal(setupDownloadHost('[fd00::5]:8443'), 'fd00::5');
  for (const authority of ['localhost.:8080', '0x7f000001', '127.5.0.1', '[::1]:8080', '[::ffff:127.0.0.1]',
    '0.0.0.0', '[::]', 'host.docker.internal', 'user@host', 'host/path', 'a?b', 'https://other', undefined]) {
    assert.equal(setupDownloadHost(authority), null);
  }
});

test('saving just the VIP and ACL via Hub sets both download locations and works after restart', async t => {
  const root = await temporary(t);
  const nomad = fakeNomad();
  const vip = 'https://nomad.site.example:4646';
  nomad.connection = async () => ({ state: 'connected' });
  const open = () => Site.open(root, {}, { client: () => nomad });
  let site = await open();
  const options = { packages: [pkg], images: { list: async () => [] }, port: 5481 };
  const distribution = new ImageDistribution({ site, ...options });
  const services = { token: 'admin-test', site, distribution };
  const server = createApi(null, null, services).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const data = JSON.stringify({ revision: 0, address: vip, token: 'test-acl' });
  const status = await new Promise((resolve, reject) => {
    const req = request({ port: server.address().port, hostname: '127.0.0.1',
      path: '/api/v1/site/nomad', method: 'PUT',
      headers: { Authorization: 'Bearer admin-test', Host: 'hub.lan:8080',
        'Content-Type': 'application/json', 'X-Forwarded-Host': 'untrusted.example' } }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(data);
  });
  assert.equal(status, 200);
  await distribution.pending;
  assert.equal(nomad.job.TaskGroups[0].Tasks[0].Artifacts[0].GetterSource,
    `http://hub.lan:5481/_hub/image-service-${pkg.sha256}.tar.gz`);
  site = await open();
  assert.equal(site.state.nomad.token, 'test-acl');
  assert.equal(site.state.nomad.distributionAddress, null);
  const restarted = new ImageDistribution({ site, ...options });
  await restarted.reconcile();
  assert.equal((await restarted.status()).source, 'http://hub.lan:5481');
  assert.deepEqual(JSON.parse((await nomad.variable(IMAGE_VARIABLE)).Items.wanted).sources, ['http://hub.lan:5481']);
  assert.equal(site.state.nomad.address, vip);
});

test('local setup uses the host route when available and explicit addresses still win', async () => {
  const nomad = fakeNomad();
  const site = { state: { nomad: { address: 'http://127.0.0.1:4646', namespace: 'default', datacenters: ['dc1'] } },
    client: () => nomad };
  let route = null;
  const options = { images: { list: async () => [] }, site, packages: [pkg], port: 5481, hostRoute: async () => route };
  const distribution = new ImageDistribution(options);
  await distribution.reconcile();
  assert.deepEqual(nomad.calls, []);
  const status = await distribution.status();
  assert.equal(status.reason, 'distribution_address_required');
  assert.equal(status.source, null);

  route = '10.12.34.56';
  for (const [override, env, expected] of [[null, undefined, 'http://10.12.34.56:5481'],
    ['hub.lan', undefined, 'http://hub.lan:5481'], ['hub.lan', '[fd00::5]:80', 'http://[fd00::5]:80']]) {
    site.state.nomad.distributionAddress = override;
    const hub = new ImageDistribution({ ...options, address: env });
    await hub.reconcile();
    const artifact = nomad.job.TaskGroups[0].Tasks[0].Artifacts[0];
    assert.equal(artifact.GetterSource, `${expected}/_hub/image-service-${pkg.sha256}.tar.gz`);
    assert.deepEqual(JSON.parse((await nomad.variable(IMAGE_VARIABLE)).Items.wanted).sources, [expected]);
  }
});

test('the status reports where the copies run and whether they hold every image', async t => {
  const root = await temporary(t);
  const source = await published(root, '1.0.0');
  const nomad = fakeNomad({
    allocations: [
      { ID: 'a', DesiredStatus: 'run', ClientStatus: 'running', NodeName: 'client-1' },
      { ID: 'b', DesiredStatus: 'run', ClientStatus: 'running', NodeName: 'client-2' },
      { ID: 'd', DesiredStatus: 'run', ClientStatus: 'pending', NodeName: 'client-4',
        TaskStates: { images: { Events: [{ Type: 'Downloading Artifacts' }] } } },
      { ID: 'c', DesiredStatus: 'run', ClientStatus: 'pending', NodeName: 'client-3',
        TaskStates: { images: { Events: [{ Type: 'Failed Artifact Download' }] } } }
    ],
    checks: { a: { x: { Check: 'images-copied', Status: 'success' } }, b: { x: { Check: 'images-copied', Status: 'failure' } } }
  });
  const site = { state: { nomad: { address: nomad.address, namespace: 'driverhub', datacenters: ['dc1'] } },
    client: () => nomad };
  const distribution = new ImageDistribution({ images: source.images, site, packages: [pkg], port: 5481, address: '10.0.0.5' });
  assert.equal((await distribution.status()).state, 'starting');
  await distribution.reconcile();
  const status = await distribution.status();
  assert.equal(status.state, 'copying');
  assert.equal(status.running, 2);
  assert.equal(status.upToDate, 1);
  assert.equal(status.images, 1);
  assert.equal(status.source, 'http://10.0.0.5:5481');
  assert.deepEqual(status.problems, [{ host: 'client-3', status: 'pending', event: 'Failed Artifact Download' }]);

  const unpackaged = new ImageDistribution({ images: source.images, site, packages: [], port: 5481 });
  assert.equal((await unpackaged.status()).state, 'unavailable');
  const unconfigured = new ImageDistribution({ images: source.images, site: { state: { nomad: { address: null } } }, packages: [pkg] });
  assert.equal((await unconfigured.status()).state, 'not_configured');
});

test('driver jobs pull from the copy on their own machine, and the clients fetch the package once', async t => {
  const root = await temporary(t);
  const site = await Site.open(join(root, 'site'), { nomad: { address: 'https://nomad.site.example' } });
  assert.equal(Deployments.forSite(site, {}).registry, IMAGE_HOST);
  assert.equal(IMAGE_HOST, '127.0.0.1:5480');
  assert.equal(sourceUrl('fd00::5', 5481), 'http://[fd00::5]:5481');

  const file = join(root, 'image-service.tar.gz');
  const bytes = 'package bytes';
  await writeFile(file, bytes);
  const current = { ...pkg, file, sha256: hash(bytes) };
  const listener = await listen(t, distributionServer(new Images(join(root, 'store')),
    { extra: packageRoute([current]) }));
  const taskFor = pkg => imageServiceJob({ namespace: 'n', datacenters: ['dc1'], source: listener, packages: [pkg] })
    .TaskGroups[0].Tasks[0];
  const task = taskFor(current);
  const previous = taskFor({ ...current, sha256: hash(`${bytes} with a longer tail`) });
  assert.notEqual(previous.Config.load, task.Config.load);
  assert.equal((await fetch(previous.Artifacts[0].GetterSource)).status, 404);
  const url = task.Artifacts[0].GetterSource;
  assert.equal(hash(await (await fetch(url)).text()), current.sha256);
  assert.equal((await fetch(url, { method: 'HEAD' })).headers.get('content-length'), String(bytes.length));
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal(await (await fetch(`${listener}/_hub/image-service.tar.gz`)).text(), bytes);
});

test('an upgrade keeps only the current Hub archive without removing other task files', async t => {
  const local = await temporary(t);
  const current = `image-service-${pkg.sha256}.tar.gz`;
  const keep = [current, 'wanted.json', 'other.tar.gz'];
  for (const name of [...keep, 'image-service.tar.gz', `image-service-${'a'.repeat(64)}.tar.gz`]) {
    await writeFile(join(local, name), name);
  }
  await prunePackages(local, current);
  assert.deepEqual((await readdir(local)).sort(), keep.sort());
});

test('healthy running clients cannot mask a third client that is still starting', async () => {
  const check = { check: { Check: 'images-copied', Status: 'success' } };
  const allocations = ['a', 'b', 'c'].map(ID => ({ ID, DesiredStatus: 'run', ClientStatus: 'running' }));
  allocations[2].ClientStatus = 'pending';
  allocations.push({ ID: 'previous-c', DesiredStatus: 'run', ClientStatus: 'failed', NextAllocation: 'c',
    TaskStates: { images: { Events: [{ Type: 'Not Restarting' }] } } });
  const nomad = fakeNomad({ allocations, checks: { a: check, b: check, c: check } });
  const site = { state: { nomad }, client: () => nomad };
  const distribution = new ImageDistribution({ site, packages: [pkg], images: { list: async () => [] }, port: 5481,
    address: '127.0.0.1' });
  await distribution.reconcile();
  const starting = await distribution.status();
  assert.equal(starting.state, 'starting');
  assert.equal(starting.upToDate, 2);
  assert.deepEqual(starting.problems, []);
  allocations[2].ClientStatus = 'running';
  assert.equal((await distribution.status()).state, 'ready');
});

test('the image service runs on every client architecture it is packaged for, and drivers only there', async t => {
  const root = await temporary(t);
  // One archive per architecture, as the container build lays them out.
  for (const [arch, bytes] of [['amd64', 'amd64 package'], ['arm64', 'arm64 package']]) {
    await mkdir(join(root, 'packages', arch), { recursive: true });
    await writeFile(join(root, 'packages', arch, 'image-service.tar.gz'), bytes);
    await writeFile(join(root, 'packages', arch, 'image-service.json'), JSON.stringify({
      tag: `driverhub/image-service:${arch}0123456789`, arch, sha256: hash(bytes), size: bytes.length }));
  }
  const packages = await readPackages(join(root, 'packages'));
  assert.deepEqual(packages.map(p => p.arch), ['amd64', 'arm64']);
  assert.deepEqual(await readPackages(join(root, 'missing')), []);

  const listener = await listen(t, distributionServer(new Images(join(root, 'store')), { extra: packageRoute(packages) }));
  const job = imageServiceJob({ namespace: 'n', datacenters: ['dc1'], source: listener, packages });
  assert.deepEqual(job.TaskGroups.map(g => [g.Name, g.Constraints.find(c => c.LTarget === '${attr.cpu.arch}').RTarget]),
    [['images-amd64', 'amd64'], ['images-arm64', 'arm64']]);
  // Every copy registers as the same service, so copies of either architecture serve each other.
  assert.deepEqual(new Set(job.TaskGroups.map(g => g.Tasks[0].Services[0].Name)), new Set([IMAGE_JOB]));
  for (const group of job.TaskGroups) {
    const task = group.Tasks[0];
    const served = await (await fetch(task.Artifacts[0].GetterSource)).text();
    assert.equal(`sha256:${hash(served)}`, task.Artifacts[0].GetterOptions.checksum);
    assert.match(served, new RegExp(group.Name.slice('images-'.length)));
  }
  // With two archives there is no unversioned download to guess between.
  assert.equal((await fetch(`${listener}/_hub/image-service.tar.gz`)).status, 404);

  const record = platforms => ({ configuration: { schemaVersion: 1, inputs: [] }, record: { image: { platforms } } });
  const spec = { nodeId: '087aa0f0-8ee9-49f0-aa74-127014499fc1', settings: {} };
  const placed = (platforms, architectures) => createJob({ spec, previous: null, running: true, migrated: false,
    image: 'x', release: record(platforms), namespace: 'n', datacenters: ['dc1'], architectures })
    .TaskGroups[0].Constraints.find(c => c.LTarget === '${attr.cpu.arch}').RTarget;
  assert.equal(placed(['linux/amd64', 'linux/arm64'], ['amd64', 'arm64']), '^(amd64|arm64)$');
  assert.equal(placed(['linux/amd64', 'linux/arm64'], ['amd64']), '^(amd64)$');
  assert.equal(placed(['linux/arm64'], []), '^(arm64)$');
  assert.throws(() => placed(['linux/arm64'], ['amd64']), error => error.code === 'no_image_service_architecture');
});
