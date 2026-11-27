import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isObject, validateSettings } from './settings.js';
import { RequestError, expect } from './errors.js';
import { publicError } from './public-error.js';
import { apiContract } from './openapi.js';
import { deployForm } from './deployment-inputs.js';
import { browserWrite } from './operator-sessions.js';
import { removeRelease } from './retention.js';
import { nomadTiming } from './nomad.js';
import { setupDownloadHost } from './image-distribution.js';

async function readSettings(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new RequestError(415, 'Expected application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 64 * 1024) throw new RequestError(413, 'Settings exceed size limit');
    chunks.push(chunk);
  }
  let settings;
  try {
    settings = JSON.parse(Buffer.concat(chunks));
  } catch {
    throw new RequestError(400, 'Malformed JSON');
  }
  if (!isObject(settings)) throw new RequestError(400, 'Expected a settings object');
  return settings;
}

class Accepted {
  constructor(operation) { this.operation = operation; }
}

class Imported {
  constructor(result) { Object.assign(this, result); }
}

async function acquire(request, operations, kind, input, run) {
  if (!request.headers.prefer?.split(',').some(value => value.trim() === 'respond-async')) return run();
  expect(operations, 'Background operations are not configured', 503);
  return new Accepted(await operations.start(kind, input, request.headers['idempotency-key'], run));
}

// Deletions carry the revision the client reviewed, so a concurrent change is not overwritten.
function revisionParam(searchParams) {
  const value = searchParams.get('revision');
  expect([...searchParams.keys()].every(key => key === 'revision') && searchParams.getAll('revision').length === 1 &&
    /^\d{1,15}$/.test(value), 'Supply the current revision as ?revision=', 400);
  return Number(value);
}

function preview(searchParams) {
  const value = searchParams.get('dryRun');
  expect([...searchParams.keys()].every(key => key === 'dryRun') && searchParams.getAll('dryRun').length <= 1,
    'Unsupported deployment query');
  expect(value === null || value === 'true' || value === 'false', 'dryRun must be true or false');
  return value === 'true';
}

async function route(request, catalog, store, services, access, coordinator) {
  const { deployments, builds, operations, site, localUsers, imports, images, apiTokens } = services;
  // A change may add, use or drop an image, so the copies on the Nomad clients are updated after it.
  const write = fn => coordinator.write(() => fn(services.deployments))
    .finally(() => { services.distribution?.trigger(); });
  const { pathname, searchParams } = new URL(request.url, 'http://localhost');
  const upload = /^\/api\/v1\/imports\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (upload) {
    expect(access === 'admin', 'Image imports require administrator access', 403, 'admin_required');
    expect(request.method === 'PUT', 'Expected PUT', 405);
    expect(imports, 'Image imports are unavailable', 503);
    let version;
    try { version = decodeURIComponent(upload[2]); } catch { throw new RequestError(400, 'Malformed release version'); }
    return new Imported(await imports.upload(request, upload[1], version));
  }
  const usersPath = /^\/api\/v1\/users(?:\/([^/]+))?$/.exec(pathname);
  if (usersPath) {
    expect(access === 'admin', 'Account management requires administrator access', 403, 'admin_required');
    expect(localUsers, 'Local accounts are not configured', 503);
    if (!usersPath[1] && request.method === 'GET') return { users: localUsers.list() };
    if (usersPath[1] && request.method === 'DELETE') {
      expect(request.operator?.username !== usersPath[1].toLowerCase(),
        'Sign in as another administrator to delete your own account', 409, 'own_account');
      return localUsers.remove(usersPath[1]);
    }
    expect(request.method === (usersPath[1] ? 'PATCH' : 'POST'), 'Invalid account request method', 405);
    const input = await readSettings(request);
    return usersPath[1] ? localUsers.update(usersPath[1], input) : localUsers.create(input);
  }
  const tokenPath = /^\/api\/v1\/site\/videoipath\/tokens\/([0-9a-f]{64})$/.exec(pathname);
  if (tokenPath) {
    expect(access === 'admin', 'Site configuration requires administrator access', 403, 'admin_required');
    expect(site, 'Site configuration is unavailable', 503);
    expect(request.method === 'DELETE', 'Expected DELETE', 405);
    return write(current => site.removeToken(tokenPath[1], revisionParam(searchParams), async nodeId => {
      expect(current?.nomad.address, 'Hub cannot check whether the device still exists without Nomad', 409,
        'deployment_unknown');
      return ![...site.journal.records.values()].some(r => r.nodeId === nodeId &&
        (r.pending || r.deleting || r.target !== current.identity(nodeId).target)) &&
        !await current.nomad.get(`driverhub-${nodeId}`);
    }));
  }
  if (pathname === '/api/v1/site/environment') {
    expect(access === 'admin', 'Site configuration requires administrator access', 403, 'admin_required');
    expect(request.method === 'GET', 'Expected GET', 405);
    return { settings: services.environment ?? [] };
  }
  const sitePath = /^\/api\/v1\/site(?:\/(nomad|videoipath|deployment|manager))?$/.exec(pathname);
  if (sitePath) {
    expect(access === 'admin', 'Site configuration requires administrator access', 403, 'admin_required');
    expect(site, 'Site configuration is unavailable', 503);
    expect(request.method === (sitePath[1] ? 'PUT' : 'GET'), 'Invalid site request method', 405);
    if (!sitePath[1]) return site.describe();
    const input = await readSettings(request);
    const setupHost = sitePath[1] === 'nomad' ? setupDownloadHost(request.headers.host, true) : null;
    return write(current => site.configure(sitePath[1], input, () => current.checkpointTarget(), setupHost));
  }
  const apiTokenPath = /^\/api\/v1\/api-tokens(?:\/([0-9a-f]{32}))?$/.exec(pathname);
  if (apiTokenPath || pathname.startsWith('/api/v1/api-tokens/')) {
    expect(access === 'admin', 'API tokens require administrator access', 403, 'admin_required');
    expect(apiTokens, 'API tokens are unavailable', 503);
    expect(apiTokenPath, 'Unknown API token', 404);
    if (apiTokenPath[1]) {
      expect(request.method === 'DELETE', 'Expected DELETE', 405);
      return apiTokens.remove(apiTokenPath[1]);
    }
    if (request.method === 'GET') return { tokens: apiTokens.list() };
    expect(request.method === 'POST', 'Expected GET or POST', 405);
    return apiTokens.create(await readSettings(request), request.operator?.username ?? null);
  }
  if (pathname === '/api/v1/openapi.json') {
    expect(request.method === 'GET', 'Expected GET', 405);
    return apiContract;
  }
  if (pathname === '/api/v1/capabilities') {
    expect(request.method === 'GET', 'Expected GET', 405);
    return { apiVersion: 'v1', access, buildsEnabled: Boolean(builds), asyncAcquisition: Boolean(operations),
      siteSetupEnabled: Boolean(site), videoIPathConfigured: Boolean(site?.state.videoipath),
      nomadConfigured: Boolean(deployments?.nomad.address),
      sharedWriters: Boolean(deployments?.sharedWriters) };
  }
  if (pathname === '/api/v1/integrations/images') {
    expect(request.method === 'GET', 'Expected GET', 405);
    return coordinator.read('images', () => services.distribution?.status() ??
      Promise.resolve({ state: 'not_configured', running: 0, upToDate: 0, images: 0, source: null, problems: [] }));
  }
  if (pathname === '/api/v1/integrations/nomad') {
    expect(request.method === 'GET', 'Expected GET', 405);
    return deployments ? coordinator.read('connection', () => deployments.nomad.connection()) : { state: 'not_configured', namespace: 'default' };
  }
  const operation = /^\/api\/v1\/operations(?:\/([^/]+))?$/.exec(pathname);
  if (operation) {
    expect(request.method === 'GET', 'Expected GET', 405);
    expect(operations, 'Background operations are not configured', 503);
    return operation[1] ? operations.get(operation[1]) : { operations: await operations.list() };
  }
  if (pathname === '/api/v1/retained') {
    expect(request.method === 'GET', 'Expected GET', 405);
    return { releases: await store.list() };
  }
  if (pathname === '/api/v1/builds') {
    expect(request.method === 'POST', 'Expected POST', 405);
    expect(builds, 'Source builds are disabled', 503);
    const input = await readSettings(request);
    return acquire(request, operations, 'build', input, () => builds.create(input));
  }
  if (pathname === '/api/v1/updates') {
    expect(request.method === 'GET', 'Expected GET', 405);
    expect(deployments, 'Deployments are not configured', 503);
    return { updates: await catalog.updates(await deployments.list()) };
  }
  if (pathname === '/api/v1/deployments/directory') {
    expect(request.method === 'GET', 'Expected GET', 405);
    expect(deployments, 'Deployments are not configured', 503);
    return { devices: await coordinator.read('directory', async () =>
      (await deployments.list()).map(({ nodeId, driverId, version }) => ({ nodeId, driverId, version, label: deployments.label(nodeId) }))) };
  }
  if (pathname === '/api/v1/deployments') {
    expect(deployments, 'Deployments are not configured', 503);
    if (request.method === 'GET') return { deployments: await coordinator.read('overview', () => deployments.overview()) };
    expect(request.method === 'POST', 'Expected GET or POST', 405);
    const input = await readSettings(request), dry = preview(searchParams);
    const stage = current => current.stage(input, dry, request.headers['idempotency-key']);
    return dry ? stage(deployments) : write(stage);
  }
  const deployment = /^\/api\/v1\/deployments\/([^/]+)(?:\/(start|stop|update|rollback|evaluations|history|label|rollout))?$/.exec(pathname);
  if (deployment) {
    expect(deployments, 'Deployments are not configured', 503);
    const [, nodeId, action] = deployment;
    if (action === 'rollout') {
      expect(request.method === 'GET', 'Expected GET', 405);
      return { rollout: await deployments.rollout(nodeId) };
    }
    if (action === 'label') {
      expect(request.method === 'PUT', 'Expected PUT', 405);
      const { label } = await readSettings(request);
      return write(current => current.relabel(nodeId, label));
    }
    if (action === 'history') {
      expect(request.method === 'GET', 'Expected GET', 405);
      return { history: await deployments.history(nodeId) };
    }
    if (action === 'evaluations') {
      expect(request.method === 'GET', 'Expected GET', 405);
      return { evaluations: await deployments.evaluations(nodeId) };
    }
    if (!action && request.method === 'DELETE') return write(current => current.remove(nodeId, revisionParam(searchParams)));
    expect(request.method === (action ? 'POST' : 'GET'), 'Invalid deployment request method', 405);
    if (!action) return deployments.status(nodeId);
    const input = await readSettings(request), dry = preview(searchParams);
    const change = current => current.change(nodeId, action, input, dry);
    return dry ? change(deployments) : write(change);
  }
  if (pathname === '/api/v1/releases') {
    if (request.method !== 'GET') throw new RequestError(405, 'Expected GET');
    return { releases: await catalog.list(searchParams.get('prerelease') === 'true') };
  }
  const match = /^\/api\/v1\/(releases|retained)\/([^/]+)\/([^/]+)(?:\/(validate|deploy-form))?$/.exec(pathname);
  if (!match) throw new RequestError(404, 'Unknown route');
  const [, collection, driverId, rawVersion, action] = match;
  let version;
  try {
    version = decodeURIComponent(rawVersion);
  } catch {
    throw new RequestError(400, 'Malformed release version');
  }
  if (collection === 'retained' && !action && request.method === 'DELETE') {
    expect(access === 'admin', 'Removing releases requires administrator access', 403, 'admin_required');
    return write(current => removeRelease({ store, images, deployments: current }, driverId, version));
  }
  if (collection === 'retained' && !action && request.method === 'PUT') {
    return acquire(request, operations, 'retain', { driverId, version }, async () => {
      const retained = await catalog.retain(driverId, version, store);
      if (!retained) throw new RequestError(404, 'Unknown upstream release');
      return retained;
    });
  }
  const method = action ? 'POST' : 'GET';
  if (request.method !== method) throw new RequestError(405, `Expected ${method}`);
  const input = action ? await readSettings(request) : null;
  const source = collection === 'retained' ? store : catalog;
  const release = await source.load(driverId, version);
  if (!release) throw new RequestError(404, 'Unknown driver release');
  if (action === 'deploy-form') return deployForm(release.configuration, input, deployments?.profile);
  return action === 'validate' ? validateSettings(release.configuration, input) : release;
}

// `token` is the emergency administrator token from the environment; `apiTokens` are the tokens
// administrators create in the web interface.
async function authorize(request, { token, apiTokens, sessions, localUsers }) {
  let access;
  if (request.headers.authorization !== undefined || (!sessions && token)) {
    const digest = value => createHash('sha256').update(value).digest();
    const provided = digest(request.headers.authorization ?? '');
    if (token && timingSafeEqual(provided, digest(`Bearer ${token}`))) return 'admin';
    access = apiTokens?.role(request.headers.authorization);
    expect(access, 'Authorization required', 401);
  } else if (sessions) {
    // Kept for rules about the operator's own account, such as not deleting it.
    request.operator = await sessions.current(request);
    expect(!request.operator.mustChangePassword, 'Change the default password before using Driver Hub', 403,
      'password_change_required');
    access = request.operator.role;
    if (request.method !== 'GET') browserWrite(request, sessions.plainHttp);
  } else {
    expect(!localUsers, 'Operator session authentication is required', 503);
    expect(/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(request.headers.host ?? ''),
      'Invalid management host', 403);
    if (request.headers.origin) {
      expect(request.headers.origin === `http://${request.headers.host}`, 'Cross-origin request denied', 403);
    }
    access = 'admin';
  }
  if (access === 'viewer') {
    const { pathname, searchParams } = new URL(request.url, 'http://localhost');
    const validation = /^\/api\/v1\/(retained|releases)\/[^/]+\/[^/]+\/(?:validate|deploy-form)$/.test(pathname);
    const plan = /^\/api\/v1\/deployments(?:\/[^/]+\/(?:start|stop|update|rollback))?$/.test(pathname) &&
      searchParams.get('dryRun') === 'true';
    expect(request.method === 'GET' || (request.method === 'POST' && (validation || plan)),
      'This operation requires administrator access', 403, 'admin_required');
  }
  return access;
}

async function dispatch(request, headers, catalog, store, services, coordinator) {
  const { pathname } = new URL(request.url, 'http://localhost');
  const { sessions, localUsers } = services;
  if (pathname.startsWith('/api/v1/auth/')) {
    expect(sessions, 'Operator sign-in is not configured', 503);
    if (pathname === '/api/v1/auth/session') {
      expect(request.method === 'GET', 'Expected GET', 405);
      return sessions.current(request);
    }
    expect(request.method === 'POST', 'Expected POST', 405);
    browserWrite(request, sessions.plainHttp);
    if (pathname === '/api/v1/auth/login') return sessions.login(request, await readSettings(request), headers);
    if (pathname === '/api/v1/auth/logout') return sessions.logout(request, headers);
    if (pathname === '/api/v1/auth/password') {
      const current = await sessions.currentIdentity(request);
      expect(current.provider === 'local' && localUsers, 'Password managed by identity provider', 403);
      const { currentPassword, newPassword } = await readSettings(request);
      if (!current.mustChangePassword || currentPassword !== undefined) {
        await sessions.verify(request, current.username, currentPassword);
      }
      expect(typeof newPassword === 'string', 'Expected newPassword');
      const updated = await localUsers.changePassword(current.username, newPassword, current.revision);
      if (current.mustChangePassword) return sessions.start(request, updated, headers);
      return sessions.logout(request, headers);
    }
    throw new RequestError(404, 'Unknown authentication route');
  }
  const access = await authorize(request, services);
  return route(request, catalog, store, services, access, coordinator);
}

export function createApi(catalog, store, services = {}) {
  // Nomad has no conditional purge, and a release can be removed while a different device
  // is staging it. Serialize manager lifecycle/site/retention writes through cleanup. Reads,
  // including plans, never wait on a writer and never supply its preconditions.
  let tail = Promise.resolve();
  const reads = new Map();
  const coordinator = {
    write(fn) {
      const run = tail.then(async () => {
        reads.clear();
        try { return await fn(); } finally { reads.clear(); }
      });
      tail = run.catch(() => {});
      return run;
    },
    read(key, fn) {
      const cached = reads.get(key);
      if (cached && Date.now() < cached.expires) return cached.promise;
      const entry = { expires: Infinity };
      const discard = () => { if (reads.get(key) === entry) reads.delete(key); };
      entry.promise = fn().then(result => {
        // Never extend a check's validity by caching its response.
        let ttl = 1000;
        if (key === 'overview') for (const row of result) {
          const at = row.communicationEvidence?.observedAt;
          if (at) ttl = Math.min(ttl, Date.parse(at) + 30000 - Date.now());
        }
        entry.expires = Date.now() + ttl;
        return result;
      }, error => { discard(); throw error; });
      reads.set(key, entry);
      return entry.promise;
    }
  };
  return createServer(async (request, response) => {
    if (services.web && !/^\/api(\/|$)/.test(new URL(request.url, 'http://localhost').pathname)) {
      try { return await services.web.serve(request, response); } catch (error) {
        console.error('Driver Hub web request failed:', error?.code ?? error?.name ?? 'unknown');
        if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return response.end();
      }
    }
    let status = 200;
    let body;
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    const metrics = services.timings && { calls: 0, bytes: 0, errors: 0, started: performance.now() };
    try {
      const run = () => dispatch(request, headers, catalog, store, services, coordinator);
      body = await (metrics ? nomadTiming.run(metrics, run) : run());
      if (body instanceof Accepted) {
        body = body.operation;
        status = 202;
        headers.Location = `/api/v1/operations/${body.id}`;
        headers['Preference-Applied'] = 'respond-async';
      } else if (body instanceof Imported) {
        status = body.created ? 201 : 200;
        body = body.detail;
        headers.Location = `/api/v1/retained/${body.record.driverId}/${encodeURIComponent(body.record.version)}`;
      }
    } catch (error) {
      ({ status, ...body } = publicError(error));
      if (status === 500) console.error('Driver Hub request failed:', error?.code ?? error?.name ?? 'unknown');
    }
    if (metrics) headers['Server-Timing'] = `hub;dur=${(performance.now() - metrics.started).toFixed(1)}, ` +
      `nomad;desc="${metrics.calls} calls, ${metrics.bytes} response bytes, ${metrics.errors} errors"`;
    response.writeHead(status, headers);
    response.end(JSON.stringify(body));
  });
}
