import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { buildOci } from '../src/builds.js';
import { Images } from '../src/images.js';
import { createJob } from '../src/job.js';
import { Nomad } from '../src/nomad.js';

const run = promisify(execFile);
async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'driverhub-runtime-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 3 }));
  return dir;
}

test('Buildx builds an OCI image; a clean OCI client pulls it from the independent service', {
  skip: !process.env.DRIVER_HUB_TEST_DOCKER
}, async t => {
  const dir = await workspace(t);
  await writeFile(join(dir, 'Dockerfile'), 'FROM scratch\nCOPY marker /marker\nCMD ["/marker"]\n');
  await writeFile(join(dir, 'marker'), randomUUID());
  await buildOci('.', dir, 'linux/amd64');
  const meta = JSON.parse(await readFile(join(dir, 'metadata.json')));
  const digest = meta['containerimage.digest'];
  const archive = join(dir, 'archive.gz');
  await writeFile(archive, gzipSync(await readFile(join(dir, 'image.tar'))));
  const images = new Images(join(dir, 'images'));
  const key = await images.publish({ driverId: 'probe', version: '1.0.0', image: { digest, platforms: ['linux/amd64'] } }, archive);
  const distributionImage = `driverhub-runtime-test:${randomUUID()}`;
  await run('docker', ['build', '-t', distributionImage, '.'], { timeout: 180000 });
  t.after(() => run('docker', ['image', 'rm', distributionImage]));
  const { stdout: container } = await run('docker', ['run', '-d', '--rm',
    '-v', `${images.root}:/images:ro`, '-e', 'DRIVER_HUB_IMAGES_DIR=/images', distributionImage, 'node', 'src/serve-images.js']);
  try {
    const image = `localhost:5000/driverhub/${key}@${digest}`;
    await run('docker', ['run', '--rm', '--network', `container:${container.trim()}`, 'regclient/regctl:v0.8.3',
      '--host', 'reg=localhost:5000,tls=disabled', 'image', 'copy', image, 'ocidir:///tmp/pulled:verified'],
    { timeout: 120000 });
  } finally {
    await run('docker', ['stop', container.trim()]);
  }
});

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('isolated Nomad server persists a staged job and rejects stale writes', {
  skip: !process.env.DRIVER_HUB_TEST_NOMAD
}, async t => {
  const dir = await workspace(t);
  const [http, rpc, serf] = await Promise.all([freePort(), freePort(), freePort()]);
  const config = join(dir, 'agent.json');
  await writeFile(config, JSON.stringify({
    name: 'driverhub-acceptance', bind_addr: '127.0.0.1', ports: { http, rpc, serf },
    advertise: { http: `127.0.0.1:${http}`, rpc: `127.0.0.1:${rpc}`, serf: `127.0.0.1:${serf}` },
    data_dir: join(dir, 'data'), disable_update_check: true, server: { enabled: true, bootstrap_expect: 1 }
  }));
  const agent = spawn(process.env.DRIVER_HUB_TEST_NOMAD, ['agent', '-config', config]);
  let diagnostics = '';
  for (const stream of [agent.stdout, agent.stderr]) stream.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-4096); });
  const closed = once(agent, 'close');
  try {
    const address = `http://127.0.0.1:${http}`;
    let leader;
    for (let i = 0; i < 60 && !leader; i++) {
      assert.equal(agent.exitCode, null, diagnostics);
      try { leader = await (await fetch(`${address}/v1/status/leader`)).json(); } catch { /* starting */ }
      if (!leader) await delay(250);
    }
    assert.ok(leader, 'Nomad did not elect a leader');
    const nomad = new Nomad(address, null);
    assert.deepEqual(await nomad.connection(), { state: 'connected', namespace: 'default' });
    const job = createJob({
      spec: { nodeId: randomUUID(), driverId: 'probe', version: '1.0.0', settings: {} },
      release: { record: { image: { platforms: ['linux/amd64'] } }, configuration: { inputs: [], controlHealth: { port: 8080, path: '/control' } } },
      namespace: 'default', datacenters: ['dc1'], running: false, previous: null, migrated: false,
      image: `images.internal/driverhub/probe@sha256:${createHash('sha256').update('probe').digest('hex')}`
    });
    const created = await nomad.submit(job, 0);
    const saved = await nomad.get(job.ID);
    assert.equal(saved.JobModifyIndex, created.revision);
    const dry = await nomad.plan(saved);
    assert.equal(dry.currentRevision, saved.JobModifyIndex);
    assert.equal(dry.schedulable, true);
    assert.ok(Array.isArray(await nomad.evaluations(job.ID)));
    assert.equal((await nomad.versions(job.ID)).Versions[0].ID, job.ID);
    assert.equal(saved.TaskGroups[0].Count, 0);
    assert.equal((await nomad.list()).find(j => j.ID === job.ID).Meta.managed_by, 'driver-hub');
    await assert.rejects(nomad.submit(job, 0), error => error.status === 409);
  } finally {
    agent.kill();
    await closed;
  }
});
