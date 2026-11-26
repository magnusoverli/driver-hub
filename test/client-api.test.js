import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createApi } from '../src/http.js';
import { Operations } from '../src/operations.js';
import { InvalidRelease } from '../src/release.js';

async function fixture(t, services = {}, catalog = null) {
  const root = await mkdtemp(join(tmpdir(), 'driverhub-operations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const operations = new Operations(root);
  const server = createApi(catalog, null, { operations, ...services }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}/api/v1`, operations, root };
}

test('async requests persist results, deduplicate concurrent retries and reject changed input', async t => {
  let calls = 0, releaseBuild;
  const ready = new Promise(resolve => { releaseBuild = resolve; });
  const builds = { async create() {
    calls++;
    await ready;
    return { record: { driverId: 'meter', version: '1.0.0', image: { digest: 'sha256:test' } } };
  } };
  const { base, root } = await fixture(t, { builds });
  const id = randomUUID();
  const send = input => fetch(`${base}/builds`, {
    method: 'POST', headers: { Prefer: 'respond-async', 'Idempotency-Key': id, 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  const [a, b] = await Promise.all([send({ driverId: 'meter' }), send({ driverId: 'meter' })]);
  assert.equal(a.status, 202);
  assert.equal(b.status, 202);
  assert.equal(a.headers.get('location'), `/api/v1/operations/${id}`);
  assert.equal((await a.json()).id, id);
  assert.equal(calls, 1);
  assert.equal((await send({ driverId: 'other' })).status, 409);
  assert.equal((await new Operations(root).get(id)).state, 'interrupted');
  releaseBuild();
  let current;
  for (let i = 0; i < 100; i++) {
    current = await (await fetch(`${base}/operations/${id}`)).json();
    if (current.state !== 'running') break;
    await delay(5);
  }
  assert.equal(current.state, 'succeeded');
  assert.equal(current.release.version, '1.0.0');
  assert.deepEqual(await new Operations(root).get(id), current);
  assert.deepEqual((await (await fetch(`${base}/operations`)).json()).operations, [current]);
  assert.equal((await (await send({ driverId: 'meter' })).json()).state, 'succeeded');
  assert.equal(calls, 1);
});

test('an async download failure is observable without exposing an internal exception', async t => {
  const { base } = await fixture(t, {}, { retain() { throw new InvalidRelease('Archive checksum mismatch'); } });
  const response = await fetch(`${base}/retained/meter/1.0.0`, { method: 'PUT', headers: { Prefer: 'respond-async' } });
  assert.equal(response.status, 202);
  const { id } = await response.json();
  for (let i = 0; i < 100; i++) {
    const result = await (await fetch(`${base}/operations/${id}`)).json();
    if (result.state === 'running') { await delay(5); continue; }
    assert.equal(result.state, 'failed');
    assert.deepEqual(result.failure, { status: 422, code: 'invalid_release', error: 'Archive checksum mismatch' });
    return;
  }
  assert.fail('Operation did not finish');
});

test('viewers discover capabilities and preview changes but cannot apply them', async t => {
  const viewerToken = randomUUID();
  const previewFlags = [];
  const deployments = { nomad: {}, async stage(input, dryRun) { previewFlags.push(dryRun); return { preview: dryRun }; } };
  const { base } = await fixture(t, { token: randomUUID(), viewerToken, deployments });
  const headers = { Authorization: `Bearer ${viewerToken}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/capabilities`)).status, 401);
  assert.equal((await (await fetch(`${base}/capabilities`, { headers })).json()).access, 'viewer');
  for (const suffix of ['', '?dryRun=false', '?dryrun=true']) {
    assert.equal((await fetch(`${base}/deployments${suffix}`, { method: 'POST', headers, body: '{}' })).status, 403);
  }
  assert.equal((await fetch(`${base}/deployments?dryRun=true&dryRun=false`, { method: 'POST', headers, body: '{}' })).status, 400);
  assert.equal((await fetch(`${base}/deployments?dryRun=true`, { method: 'POST', headers, body: '{}' })).status, 200);
  assert.deepEqual(previewFlags, [true]);
  const contract = await (await fetch(`${base}/openapi.json`, { headers })).json();
  assert.equal(contract.openapi, '3.1.0');
  assert.ok(contract.paths['/builds'].post.responses['202']);
  assert.ok(contract.paths['/deployments/{nodeId}/evaluations'].get);
});
