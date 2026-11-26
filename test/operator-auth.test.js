import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApi } from '../src/http.js';
import { LocalUsers } from '../src/local-users.js';
import { OperatorSessions } from '../src/operator-sessions.js';

test('manager bootstraps once from a file and still requires sign-in on loopback after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'driverhub-bootstrap-'));
  const passwordFile = join(root, 'bootstrap');
  const password = randomUUID();
  let manager, closed;
  try {
    await writeFile(passwordFile, password + '\n', { mode: 0o600 });
    for (const first of [true, false]) {
      const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', DRIVER_HUB_DATA_DIR: root,
        DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE: passwordFile, DRIVER_HUB_BOOTSTRAP_USERNAME: 'installer' };
      delete env.DRIVER_HUB_ADMIN_TOKEN;
      delete env.DRIVER_HUB_VIEWER_TOKEN;
      manager = spawn(process.execPath, ['src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      closed = once(manager, 'exit');
      const lines = createInterface({ input: manager.stdout });
      const [line] = await Promise.race([once(lines, 'line'), closed.then(() => { throw new Error('Manager exited before listening'); })]);
      const url = line.match(/http:\/\/127\.0\.0\.1:\d+\/api\/v1/)[0];
      assert.equal((await fetch(`${url}/capabilities`)).status, 401);
      const res = await fetch(`${url}/auth/login`, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Driver-Hub-Request': '1'
      }, body: JSON.stringify({ username: 'installer', password }) });
      assert.equal(res.status, 200);
      manager.kill();
      await closed;
      manager = null;
      if (first) await rm(passwordFile);
    }
  } finally {
    if (manager) { manager.kill(); await closed; }
    await rm(root, { recursive: true, force: true });
  }
});

test('local accounts, browser sessions, service tokens and role changes through the management API', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'driverhub-users-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const localUsers = await LocalUsers.open(directory);
  let now = Date.now();
  const sessions = new OperatorSessions(localUsers, () => now);
  const token = randomUUID();
  const server = createApi(null, null, { localUsers, sessions, token }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const send = (path, method = 'GET', input, headers = {}) => fetch(`${base}${path}`, { method,
    headers: { 'Content-Type': 'application/json', 'X-Driver-Hub-Request': '1', ...headers },
    body: input === undefined ? undefined : JSON.stringify(input) });
  const machine = { Authorization: `Bearer ${token}` };
  const admin = { username: 'Operator', role: 'admin', password: randomUUID() };
  const viewer = { username: 'reader', role: 'viewer', password: randomUUID() };
  const login = async user => {
    const res = await send('/auth/login', 'POST', { username: user.username, password: user.password });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { username: user.username.toLowerCase(), role: user.role, provider: 'local' });
    const header = res.headers.get('set-cookie');
    assert.match(header, /Path=\/; HttpOnly; Secure; SameSite=Strict/);
    return { Cookie: header.split(';')[0] };
  };
  assert.equal((await send('/users', 'POST', admin)).status, 401);
  assert.equal((await send('/users', 'POST', viewer, machine)).status, 409);
  assert.equal((await send('/users', 'POST', admin, machine)).status, 200);
  const adminCookie = await login(admin);
  assert.equal((await send('/users', 'POST', viewer, { ...adminCookie, 'X-Driver-Hub-Request': '' })).status, 403);
  assert.equal((await send('/users', 'POST', viewer, { ...adminCookie, Origin: 'https://other.example' })).status, 403);
  assert.equal((await send('/users', 'POST', viewer, adminCookie)).status, 200);
  assert.equal((await send('/users/operator', 'PATCH', { enabled: false }, adminCookie)).status, 409);
  const userCookie = await login(viewer);
  assert.equal((await send('/auth/session', 'GET', undefined, userCookie)).status, 200);
  assert.equal((await (await send('/capabilities', 'GET', undefined, userCookie)).json()).access, 'viewer');
  assert.equal((await send('/users', 'GET', undefined, userCookie)).status, 403);
  assert.equal((await send('/builds', 'POST', {}, userCookie)).status, 403);
  assert.equal((await send('/auth/password', 'POST', { currentPassword: 'wrong', newPassword: randomUUID() }, userCookie)).status, 401);
  const replacement = randomUUID();
  assert.equal((await send('/auth/password', 'POST', { currentPassword: viewer.password, newPassword: replacement }, userCookie)).status, 200);
  assert.equal((await send('/auth/session', 'GET', undefined, userCookie)).status, 401);
  assert.equal((await send('/auth/login', 'POST', viewer)).status, 401);
  viewer.password = replacement;
  const newCookie = await login(viewer);
  assert.equal((await send('/auth/logout', 'POST', {}, newCookie)).status, 200);
  assert.equal((await send('/auth/session', 'GET', undefined, newCookie)).status, 401);
  const another = await login(viewer);
  assert.equal((await send('/users/reader', 'PATCH', { role: 'admin' }, adminCookie)).status, 200);
  assert.equal((await send('/auth/session', 'GET', undefined, another)).status, 401);
  assert.equal((await send('/users/reader', 'PATCH', { enabled: false }, adminCookie)).status, 200);
  const denied = await send('/auth/login', 'POST', viewer);
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), await (await send('/auth/login', 'POST', { ...viewer, username: 'absent' })).json());
  now += 8 * 60 * 60 * 1000;
  assert.equal((await send('/auth/session', 'GET', undefined, adminCookie)).status, 401);
  const saved = await readFile(join(directory, 'users.json'), 'utf8');
  assert.ok(!saved.includes(admin.password) && !saved.includes(replacement));
  const reopened = await LocalUsers.open(directory);
  assert.equal((await reopened.authenticate(admin.username, admin.password)).role, 'admin');
  assert.equal(await reopened.authenticate(viewer.username, viewer.password), null);
});

test('provider-independent sessions expire, reject changed identities and bound failed sign-ins', async () => {
  let identity = { provider: 'test-directory', username: 'person', role: 'viewer', revision: 'v1' };
  const provider = { authenticate: async () => identity, resolve: async () => identity };
  let now = 0;
  const sessions = new OperatorSessions(provider, () => now);
  const request = { headers: {}, socket: { remoteAddress: 'test' } };
  const headers = {};
  await sessions.login(request, {}, headers);
  request.headers.cookie = headers['Set-Cookie'].split(';')[0];
  assert.equal((await sessions.current(request)).provider, 'test-directory');
  identity = null;
  await assert.rejects(sessions.current(request), { status: 401 });
  for (let i = 0; i < 15; i++) await assert.rejects(sessions.login(request, {}, {}), { status: 401 });
  await assert.rejects(sessions.login(request, {}, {}), { status: 429 });
  now += 60000;
  await assert.rejects(sessions.login(request, {}, {}), { status: 401 });
});
