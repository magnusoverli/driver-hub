import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { buildOci } from '../src/builds.js';
import { Deployments } from '../src/deployments.js';
import { createApi } from '../src/http.js';
import { Images, imageKey } from '../src/images.js';
import { Nomad } from '../src/nomad.js';
import { ReleaseStore } from '../src/release-store.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function makeRelease(root, store, driverId, version) {
  const dir = await mkdtemp(join(root, 'context-'));
  const platform = process.env.DRIVER_HUB_TEST_PLATFORM ?? 'linux/amd64';
  const healthPath = `/probe-${version.replaceAll('.', '-')}`;
  const probe = `test "$VIDEOIPATH_NODE_ID" = "${driverId.slice(6)}" && test "$MARKER" = "${version}" && ` +
    `test "$(cat /run/probe-marker)" = 'public-test-marker' && test "$PROBE_VALUE" = 'public-test-marker' && mkdir -p /tmp/www && ` +
    `echo ok >/tmp/www${healthPath} && exec httpd -f -p 8080 -h /tmp/www`;
  await writeFile(join(dir, 'Dockerfile'), `FROM busybox:1.37\nCMD ${JSON.stringify(['sh', '-ec', probe])}\n`);
  await buildOci('.', dir, platform);
  const info = JSON.parse(await readFile(join(dir, 'metadata.json')));
  const bytes = gzipSync(await readFile(join(dir, 'image.tar')));
  const configuration = { schemaVersion: 1, controlHealth: { port: 8080, path: healthPath },
    inputs: [
      { name: 'marker', required: true, type: 'string', env: 'MARKER', default: version },
      { name: 'reference', required: true, type: 'string', secret: true, file: '/run/probe-marker' },
      { name: 'envReference', required: true, type: 'string', secret: true, env: 'PROBE_VALUE' }
    ] };
  const configBytes = Buffer.from(JSON.stringify(configuration));
  const record = { schemaVersion: 1, driverId, version, displayName: 'Disposable synthetic control probe',
    source: { directory: 'test/active-nomad', commit: createHash('sha1').update(probe).digest('hex') },
    configuration: { file: 'driver-config.json', sha256: hash(configBytes) },
    image: { archive: 'probe.oci.tar.gz', archiveSha256: hash(bytes), platforms: [platform], digest: info['containerimage.digest'] } };
  await store.save({ detail: { record, configuration }, configBytes, manifestBytes: Buffer.from(JSON.stringify(record)) },
    Readable.from([bytes]));
  return record;
}

test('real Nomad client runs, upgrades, rolls back and stops a digest-pinned synthetic driver', {
  skip: !process.env.DRIVER_HUB_TEST_ACTIVE_NOMAD
}, async t => {
  const address = process.env.DRIVER_HUB_TEST_ACTIVE_NOMAD;
  const registry = process.env.DRIVER_HUB_TEST_IMAGE_HOST;
  const imageRoot = process.env.DRIVER_HUB_TEST_IMAGES_DIR;
  assert.ok(registry && imageRoot, 'Set the test image service hostname and its writable image directory');
  const root = await mkdtemp(join(tmpdir(), 'driverhub-active-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ReleaseStore(join(root, 'releases'));
  const images = new Images(imageRoot);
  const nomad = new Nomad(address, process.env.DRIVER_HUB_TEST_NOMAD_TOKEN, process.env.DRIVER_HUB_TEST_NAMESPACE);
  const deployments = new Deployments({ nomad, registry, store, images,
    datacenters: [process.env.DRIVER_HUB_TEST_DATACENTER ?? 'dc1'] });
  const server = createApi(null, store, { deployments }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/deployments`;
  const nodeId = randomUUID(), driverId = `probe-${nodeId}`;
  async function api(path, body) {
    const res = await fetch(`${url}${path}`, body && {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const result = await res.json();
    assert.ok(res.ok, `${res.status}: ${JSON.stringify(result)}`);
    return result;
  }
  async function until(predicate, label) {
    let state;
    const deadline = Date.now() + 180000;
    do {
      state = await api(`/${nodeId}`);
      if (predicate(state)) return state;
      await delay(1500);
    } while (Date.now() < deadline);
    assert.fail(`Timed out waiting for ${label}: ${JSON.stringify(state.allocations)}`);
  }
  const records = [];
  const headers = { 'Content-Type': 'application/json' };
  if (nomad.token) headers['X-Nomad-Token'] = nomad.token;
  const varPath = `nomad/jobs/driverhub-${nodeId}`;
  const variable = new URL(`/v1/var/${varPath}`, address);
  variable.searchParams.set('namespace', nomad.namespace);
  variable.searchParams.set('cas', '0');
  let varIndex;
  try {
    for (const version of ['1.0.0', '2.0.0']) records.push(await makeRelease(root, store, driverId, version));
    const provisioned = await fetch(variable, { method: 'PUT', headers, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ Path: varPath, Items: { probe_marker: 'public-test-marker' } }) });
    assert.ok(provisioned.ok, `Could not provision test-scoped Nomad Variable (${provisioned.status})`);
    varIndex = (await provisioned.json()).ModifyIndex;
    assert.ok(Number.isSafeInteger(varIndex) && varIndex > 0);
    const markerRef = { secretRef: 'probe_marker' };
    const stage = await api('', { nodeId, driverId, version: '1.0.0', settings: { reference: markerRef, envReference: markerRef } });
    let expected = await api(`/${nodeId}/start`, { revision: stage.revision, originalStopped: true });
    for (const [i, action] of ['update', 'rollback', 'stop'].entries()) {
      const record = records[i === 1 ? 1 : 0];
      const state = await until(s => s.communication === 'driver-reports-connected' &&
        s.image.endsWith(`@${record.image.digest}`), record.version);
      assert.equal(state.nodeId, nodeId);
      assert.equal(state.revision, expected.revision);
      expected = await api(`/${nodeId}/${action}`, { revision: state.revision, version: '2.0.0' });
    }
    await until(s => s.requested === 'stopped' && s.allocations.every(a =>
      ['complete', 'failed', 'lost'].includes(a.status)), 'stopped allocation');
  } finally {
    // Only purge this test's unique job, never pre-existing jobs or release storage.
    const job = await nomad.get(`driverhub-${nodeId}`);
    if (job) {
      assert.equal(JSON.parse(job.Meta.spec).driverId, driverId);
      const endpoint = new URL(`/v1/job/${job.ID}`, address);
      endpoint.searchParams.set('namespace', nomad.namespace);
      endpoint.searchParams.set('purge', 'true');
      const res = await fetch(endpoint, { method: 'DELETE', headers, signal: AbortSignal.timeout(20000) });
      assert.ok(res.ok, 'Could not clean up disposable Nomad job');
    }
    if (varIndex) {
      variable.searchParams.set('cas', String(varIndex));
      const res = await fetch(variable, { method: 'DELETE', headers, signal: AbortSignal.timeout(20000) });
      assert.ok(res.ok, 'Could not clean up disposable job Variable');
    }
    for (const record of records) await rm(join(imageRoot, imageKey(record)), { recursive: true, force: true });
  }
});
