// Run via stdin inside a fresh, disposable Compose manager (workdir /app).
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOci } from './src/builds.js';
import { readPackages } from './src/image-distribution.js';
import { dockerHostFor } from './src/host-route.js';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';

// Linux host-route lookup, even if the operator visits Hub at localhost. UDP route selection
// to a documentation-only IP sends no traffic. Don't accept the manager container's interface.
const hostIP = await dockerHostFor('http://192.0.2.1:4646');
assert.ok(isIPv4(hostIP), 'Compose host-route helper must return the host IP');
assert.ok(!Object.values(networkInterfaces()).flat().some(iface => iface.address === hostIP));

// Every manager image carries the image service for both client architectures, whatever its own.
const packages = await readPackages();
assert.deepEqual(packages.map(pkg => pkg.arch), ['amd64', 'arm64']);
for (const pkg of packages) {
  const response = await fetch(`http://127.0.0.1:5481/_hub/image-service-${pkg.sha256}.tar.gz`);
  assert.equal(response.status, 200, `${pkg.arch} package`);
  const hash = createHash('sha256');
  for await (const bytes of response.body) hash.update(bytes);
  assert.equal(hash.digest('hex'), pkg.sha256, `${pkg.arch} package`);
}
const nativeArch = { x64: 'amd64', arm64: 'arm64' }[process.arch];

const api = 'http://127.0.0.1:8080/api/v1';
const headers = { 'Content-Type': 'application/json', 'X-Driver-Hub-Request': '1' };
async function signIn(password) {
  const login = await fetch(`${api}/auth/login`, { method: 'POST', headers,
    body: JSON.stringify({ username: 'admin', password }) });
  assert.equal(login.status, 200);
  headers.Cookie = login.headers.get('set-cookie').split(';')[0];
  return login.json();
}
const currentPassword = 'LicenseToDeploy!';
assert.equal((await signIn(currentPassword)).mustChangePassword, true);
assert.equal((await fetch(`${api}/site`, { headers })).status, 403);
const newPassword = randomUUID();
const changed = await fetch(`${api}/auth/password`, { method: 'POST', headers,
  body: JSON.stringify({ currentPassword, newPassword }) });
assert.equal(changed.status, 200);
assert.equal((await fetch(`${api}/site`, { headers })).status, 401);
await signIn(newPassword);
const site = await (await fetch(`${api}/site`, { headers })).json();
assert.equal(site.nomad.address, null, 'Only use a fresh smoke-test installation');
assert.equal(site.manager.buildsAvailable, true);
assert.equal(site.manager.buildsEnabled, false);
const disabled = await fetch(`${api}/builds`, { method: 'POST', headers, body: '{}' });
assert.equal(disabled.status, 503);
const enabled = await fetch(`${api}/site/manager`, { method: 'PUT', headers,
  body: JSON.stringify({ revision: site.revision, buildsEnabled: true }) });
assert.equal(enabled.status, 200);
assert.equal((await (await fetch(`${api}/capabilities`, { headers })).json()).buildsEnabled, true);

// Exercise the export Hub uses without relying on a particular upstream driver or base image.
const work = await mkdtemp(join(tmpdir(), 'hub-build-smoke-'));
try {
  await writeFile(join(work, 'Dockerfile'), 'FROM scratch\nCOPY marker /marker\n');
  await writeFile(join(work, 'marker'), 'Driver Hub build test\n');
  await buildOci('.', work, `linux/${nativeArch}`);
  const metadata = JSON.parse(await readFile(join(work, 'metadata.json'), 'utf8'));
  assert.match(metadata['containerimage.digest'], /^sha256:[0-9a-f]{64}$/);
  assert.ok((await stat(join(work, 'image.tar'))).size > 0);
} finally { await rm(work, { recursive: true, force: true }); }
console.log('Packaged image service verified; builds default off, admin opt-in and OCI export passed.');
