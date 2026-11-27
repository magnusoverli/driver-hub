import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
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
        DRIVER_HUB_DISTRIBUTION_PORT: '0',
        DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE: passwordFile, DRIVER_HUB_BOOTSTRAP_USERNAME: 'installer' };
      delete env.DRIVER_HUB_ADMIN_TOKEN;
      delete env.DRIVER_HUB_VIEWER_TOKEN;
      manager = spawn(process.execPath, ['src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      closed = once(manager, 'exit');
      const lines = createInterface({ input: manager.stdout });
      const api = (async () => {
        for await (const line of lines) {
          const found = line.match(/http:\/\/127\.0\.0\.1:\d+\/api\/v1/);
          if (found) return found[0];
        }
        throw new Error('Manager exited before listening');
      })();
      const url = await Promise.race([api, closed.then(() => { throw new Error('Manager exited before listening'); })]);
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

test('the default password stays restricted across restarts and cannot be reused after rotation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'driverhub-first-login-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const password = 'LicenseToDeploy!';
  const setup = await LocalUsers.open(directory);
  await setup.create({ username: 'admin', role: 'admin', password });
  const users = await LocalUsers.open(directory);
  const sessions = new OperatorSessions(users);
  const server = createApi(null, null, { localUsers: users, sessions }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const send = (path, cookie = '', body) => fetch(base + path, {
    method: body ? 'POST' : 'GET', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Driver-Hub-Request': '1' },
    body: JSON.stringify(body)
  });
  const login = () => send('/auth/login', '', { username: 'admin', password });
  const first = await login();
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const other = (await login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await first.json()).mustChangePassword, true);
  assert.equal((await (await send('/auth/session', cookie)).json()).mustChangePassword, true);
  assert.equal((await send('/auth/password', cookie, { currentPassword: password, newPassword: password })).status, 400);
  for (const response of [await send('/users', cookie), await send('/api-tokens', cookie, { name: 'test', role: 'admin' })]) {
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'password_change_required');
  }
  const newPassword = randomUUID();
  assert.equal((await send('/auth/password', cookie, { currentPassword: password, newPassword })).status, 200);
  assert.equal((await send('/auth/session', other)).status, 401);
  assert.equal((await login()).status, 401);
  const reopened = await LocalUsers.open(directory);
  assert.equal((await reopened.authenticate('admin', newPassword)).mustChangePassword, false);
  await assert.rejects(reopened.update('admin', { password }), { status: 400 });
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
  assert.equal((await send('/imports/meter/1.0.0', 'PUT', {}, { ...adminCookie, 'X-Driver-Hub-Request': '' })).status, 403);
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

test('deleting an account ends its sessions, keeps an administrator and never revives old sessions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'driverhub-delete-users-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const localUsers = await LocalUsers.open(directory);
  const sessions = new OperatorSessions(localUsers);
  const token = randomUUID();
  const server = createApi(null, null, { localUsers, sessions, token }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const send = (path, method = 'GET', input, headers = {}) => fetch(`${base}${path}`, { method,
    headers: { 'Content-Type': 'application/json', 'X-Driver-Hub-Request': '1', ...headers },
    body: input === undefined ? undefined : JSON.stringify(input) });
  const machine = { Authorization: `Bearer ${token}` };
  const login = async (username, password) => {
    const res = await send('/auth/login', 'POST', { username, password });
    assert.equal(res.status, 200);
    return { Cookie: res.headers.get('set-cookie').split(';')[0] };
  };
  const first = { username: 'first', role: 'admin', password: randomUUID() };
  const other = { username: 'other', role: 'viewer', password: randomUUID() };
  for (const account of [first, other]) assert.equal((await send('/users', 'POST', account, machine)).status, 200);

  // The only administrator cannot be deleted, and an operator cannot delete their own account.
  const lastAdmin = await send('/users/first', 'DELETE', undefined, machine);
  assert.equal(lastAdmin.status, 409);
  assert.equal((await lastAdmin.json()).code, 'last_admin');
  const firstSession = await login('first', first.password);
  const own = await send('/users/FIRST', 'DELETE', undefined, firstSession);
  assert.equal((await own.json()).code, 'own_account');

  const otherSession = await login('other', other.password);
  assert.equal((await send('/users/other', 'DELETE', undefined, otherSession)).status, 403);
  assert.equal((await send('/users/other', 'DELETE', undefined, { ...firstSession, 'X-Driver-Hub-Request': '' })).status,
    403, 'browser writes still need the request header');
  const deleted = await send('/users/other', 'DELETE', undefined, firstSession);
  assert.deepEqual(await deleted.json(), { username: 'other', deleted: true });
  assert.equal((await send('/auth/session', 'GET', undefined, otherSession)).status, 401);
  assert.equal((await send('/users/other', 'DELETE', undefined, machine)).status, 404);
  assert.deepEqual((await (await send('/users', 'GET', undefined, machine)).json()).users.map(u => u.username), ['first']);

  // Recreating the name does not bring a session of the deleted account back, also after a restart.
  const again = await login('first', first.password);
  const kept = await login('first', first.password);
  assert.equal((await send('/users', 'POST', other, machine)).status, 200);
  assert.equal((await send('/auth/session', 'GET', undefined, otherSession)).status, 401);
  const reopened = await LocalUsers.open(directory);
  assert.ok(reopened.resolve('other').revision > 1);
  assert.equal((await send('/auth/session', 'GET', undefined, again)).status, 200);
  assert.equal((await send('/auth/session', 'GET', undefined, kept)).status, 200);
});

test('an account named after a built-in object property keeps a whole-number revision across restarts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'driverhub-property-users-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const users = await LocalUsers.open(directory);
  await users.create({ username: 'first', role: 'admin', password: randomUUID() });
  await users.create({ username: 'constructor', role: 'viewer', password: randomUUID() });
  assert.equal(users.resolve('constructor').revision, 1);
  assert.equal((await LocalUsers.open(directory)).resolve('constructor').revision, 1);
  await users.remove('constructor');
  await users.create({ username: 'constructor', role: 'viewer', password: randomUUID() });
  assert.equal((await LocalUsers.open(directory)).resolve('constructor').revision, 2);
});

test('sign-in works over plain HTTP from another host only when the manager allows it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'driverhub-plain-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const users = await LocalUsers.open(directory);
  const password = randomUUID();
  await users.create({ username: 'operator', role: 'admin', password });
  // A browser on another machine, visiting the manager by its network address over HTTP. Node's
  // fetch would replace the Host header, so requests go through node:http.
  const host = 'hub.site.example:8080';
  const browser = { 'Content-Type': 'application/json', 'X-Driver-Hub-Request': '1', Host: host, Origin: `http://${host}` };
  function send(port, method, path, headers, body) {
    return new Promise((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, method, path: `/api/v1${path}`, headers }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, cookie: response.headers['set-cookie']?.[0],
          body: text ? JSON.parse(text) : null }));
      });
      request.on('error', reject);
      request.end(body && JSON.stringify(body));
    });
  }
  async function manager(plainHttp) {
    const server = createApi(null, null, { localUsers: users,
      sessions: new OperatorSessions(users, Date.now, { plainHttp }) }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    return server.address().port;
  }
  const credentials = { username: 'operator', password };

  // By default the cookie is Secure, and an http:// origin other than localhost is refused.
  const secure = await manager(false);
  const refused = await send(secure, 'POST', '/auth/login', browser, credentials);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'csrf_check_failed');
  const local = await send(secure, 'POST', '/auth/login', { ...browser, Host: 'localhost:8080', Origin: 'http://localhost:8080' },
    credentials);
  assert.match(local.cookie, /^__Host-driverhub_session=[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Strict/);

  const plain = await manager(true);
  const login = await send(plain, 'POST', '/auth/login', browser, credentials);
  assert.equal(login.status, 200);
  assert.match(login.cookie, /^driverhub_session=[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800$/);
  const cookie = login.cookie.split(';')[0];
  assert.equal((await send(plain, 'GET', '/auth/session', { ...browser, Cookie: cookie })).body.username, 'operator');
  // The other protections stay: the request header and the same origin.
  assert.equal((await send(plain, 'POST', '/auth/logout', { ...browser, Cookie: cookie, Origin: 'http://elsewhere.example' })).status, 403);
  const { 'X-Driver-Hub-Request': _, ...headerless } = browser;
  assert.equal((await send(plain, 'POST', '/auth/logout', { ...headerless, Cookie: cookie })).status, 403);
  assert.equal((await send(plain, 'POST', '/auth/logout', { ...browser, Cookie: cookie })).status, 200);
});
