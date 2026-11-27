import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ApiTokens } from '../src/api-tokens.js';
import { Deployments } from '../src/deployments.js';
import { readEnvironment } from '../src/environment.js';
import { createApi } from '../src/http.js';
import { Site } from '../src/site.js';

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'driverhub-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function serve(t, services) {
  // Copies getters as getters, so a test can swap a reopened store in.
  const all = Object.defineProperties({ token: 'emergency' }, Object.getOwnPropertyDescriptors(services));
  const server = createApi(null, null, all).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  return async (method, path, body, token = 'emergency') => {
    const response = await fetch(`${base}${path}`, { method, body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    return { status: response.status, body: await response.json() };
  };
}

test('API tokens are shown once, stored only as hashes, keep their role across restarts and stop working when deleted', async t => {
  const root = await temporary(t);
  let apiTokens = await ApiTokens.open(root);
  const call = await serve(t, { get apiTokens() { return apiTokens; } });

  const viewer = await call('POST', '/api-tokens', { name: 'Monitoring', role: 'viewer' });
  assert.equal(viewer.status, 200);
  assert.match(viewer.body.token, /^dh_[\w-]{43}$/);
  assert.equal(viewer.body.createdBy, null);
  assert.equal((await call('POST', '/api-tokens', { name: 'monitoring', role: 'admin' })).body.code, 'token_name_taken');
  assert.equal((await call('POST', '/api-tokens', { name: ' padded', role: 'viewer' })).status, 400);
  assert.equal((await call('POST', '/api-tokens', { name: 'Other', role: 'owner' })).status, 400);
  const admin = await call('POST', '/api-tokens', { name: 'Deploy script', role: 'admin' });

  const listed = (await call('GET', '/api-tokens')).body.tokens;
  assert.deepEqual(listed.map(token => [token.name, token.role]), [['Monitoring', 'viewer'], ['Deploy script', 'admin']]);
  assert.ok(listed.every(token => !('token' in token) && !('hash' in token)));
  const stored = await readFile(join(root, 'api-tokens.json'), 'utf8');
  assert.ok(!stored.includes(viewer.body.token) && !stored.includes(admin.body.token));

  assert.equal((await call('GET', '/capabilities', undefined, viewer.body.token)).body.access, 'viewer');
  assert.equal((await call('GET', '/api-tokens', undefined, viewer.body.token)).status, 403);
  assert.equal((await call('GET', '/api-tokens', undefined, admin.body.token)).status, 200);
  assert.equal((await call('GET', '/capabilities', undefined, 'dh_unknown')).status, 401);

  apiTokens = await ApiTokens.open(root);
  assert.equal((await call('GET', '/capabilities', undefined, admin.body.token)).body.access, 'admin');
  assert.equal((await call('DELETE', `/api-tokens/${viewer.body.id}`)).status, 200);
  assert.equal((await call('DELETE', `/api-tokens/${viewer.body.id}`)).status, 404);
  assert.equal((await call('GET', '/capabilities', undefined, viewer.body.token)).status, 401);
  assert.equal((await ApiTokens.open(root)).list().length, 1);
});

test('deployment and manager settings are validated, saved with the site and used by deployments', async t => {
  const root = await temporary(t);
  const open = () => Site.open(root, {}, { client: () => ({ address: null, namespace: 'default' }) });
  let site = await open();
  const call = await serve(t, { get site() { return site; },
    get deployments() { return Deployments.forSite(site, {}); }, environment: readEnvironment({}).entries });

  const initial = (await call('GET', '/site')).body;
  assert.deepEqual(initial.deployment, { imageHost: null, nomadUiOrigin: null, sharedWriters: false });
  assert.deepEqual(initial.manager, { buildsEnabled: false, timings: false, buildsAvailable: false });
  assert.equal((await call('GET', '/capabilities')).body.imageHostConfigured, false);

  for (const imageHost of ['images', 'https://images.site', 'images.site/path', 'images.site:port'])
    assert.equal((await call('PUT', '/site/deployment', { revision: 0, imageHost })).status, 400, imageHost);
  for (const nomadUiOrigin of ['http://nomad.site', 'https://nomad.site/ui', 'https://user:pw@nomad.site'])
    assert.equal((await call('PUT', '/site/deployment', { revision: 0, nomadUiOrigin })).status, 400, nomadUiOrigin);
  assert.equal((await call('PUT', '/site/deployment', { revision: 0, sharedWriters: null })).status, 400);
  assert.equal((await call('PUT', '/site/deployment', { revision: 0, address: 'nomad.site' })).status, 400);

  const saved = await call('PUT', '/site/deployment', { revision: 0, imageHost: 'images.site:5000',
    nomadUiOrigin: 'https://nomad.site/', sharedWriters: true });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.deployment, { imageHost: 'images.site:5000', nomadUiOrigin: 'https://nomad.site',
    sharedWriters: true });
  const capabilities = (await call('GET', '/capabilities')).body;
  assert.equal(capabilities.imageHostConfigured, true);
  assert.equal(capabilities.sharedWriters, true);
  assert.equal((await call('PUT', '/site/deployment', { revision: 0, sharedWriters: false })).body.code, 'revision_conflict');

  site = await open();
  const cleared = await call('PUT', '/site/deployment', { revision: 1, nomadUiOrigin: null });
  assert.deepEqual(cleared.body.deployment, { imageHost: 'images.site:5000', nomadUiOrigin: null, sharedWriters: true });

  assert.equal((await call('PUT', '/site/manager', { revision: 2, buildsEnabled: true })).body.code, 'builds_unavailable');
  const timed = await call('PUT', '/site/manager', { revision: 2, timings: true, buildsEnabled: false });
  assert.deepEqual(timed.body.manager, { buildsEnabled: false, timings: true, buildsAvailable: false });
  assert.equal((await open()).state.manager.timings, true);

  const environment = (await call('GET', '/site/environment')).body.settings;
  assert.ok(environment.some(setting => setting.name === 'DRIVER_HUB_DATA_DIR'));
});

test('a manager that can build lets administrators turn builds on', async t => {
  const site = await Site.open(await temporary(t), {}, { buildsAvailable: true });
  const call = await serve(t, { site });
  const saved = await call('PUT', '/site/manager', { revision: 0, buildsEnabled: true });
  assert.deepEqual(saved.body.manager, { buildsEnabled: true, timings: false, buildsAvailable: true });
});

test('the environment listing says where each startup setting comes from and never shows a secret', async t => {
  const entries = readEnvironment({ PORT: '9000', DRIVER_HUB_DATA_DIR: '/srv/hub', DRIVER_HUB_ADMIN_TOKEN: 'emergency-value',
    HOST: '' }).entries;
  const byName = Object.fromEntries(entries.map(entry => [entry.name, entry]));
  assert.deepEqual(byName.PORT, { name: 'PORT', secret: false, source: 'environment', value: '9000' });
  assert.deepEqual(byName.HOST, { name: 'HOST', secret: false, source: 'default', value: '127.0.0.1' });
  assert.equal(byName.DRIVER_HUB_IMAGES_DIR.value, join('/srv/hub', 'images'));
  assert.equal(byName.DRIVER_HUB_IMAGES_DIR.source, 'default');
  assert.deepEqual(byName.DRIVER_HUB_ADMIN_TOKEN, { name: 'DRIVER_HUB_ADMIN_TOKEN', secret: true,
    source: 'environment', value: null });
  assert.equal(byName.DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE.source, 'unset');
  assert.ok(!JSON.stringify(entries).includes('emergency-value'));

  const call = await serve(t, { environment: entries, apiTokens: { role: () => 'viewer' } });
  assert.equal((await call('GET', '/site/environment')).body.settings.length, entries.length);
  assert.equal((await call('GET', '/site/environment', undefined, 'viewer')).status, 403);
});
