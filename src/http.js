import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isObject, validateSettings } from './settings.js';
import { RequestError, expect } from './errors.js';
import { publicError } from './public-error.js';
import { apiContract } from './openapi.js';

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

async function acquire(request, operations, kind, input, run) {
  if (!request.headers.prefer?.split(',').some(value => value.trim() === 'respond-async')) return run();
  expect(operations, 'Background operations are not configured', 503);
  return new Accepted(await operations.start(kind, input, request.headers['idempotency-key'], run));
}

function preview(searchParams) {
  const value = searchParams.get('dryRun');
  expect([...searchParams.keys()].every(key => key === 'dryRun') && searchParams.getAll('dryRun').length <= 1,
    'Unsupported deployment query');
  expect(value === null || value === 'true' || value === 'false', 'dryRun must be true or false');
  return value === 'true';
}

async function route(request, catalog, store, { deployments, builds, operations }, access) {
  const { pathname, searchParams } = new URL(request.url, 'http://localhost');
  if (pathname === '/api/v1/openapi.json') {
    expect(request.method === 'GET', 'Expected GET', 405);
    return apiContract;
  }
  if (pathname === '/api/v1/capabilities') {
    expect(request.method === 'GET', 'Expected GET', 405);
    return { apiVersion: 'v1', access, buildsEnabled: Boolean(builds), asyncAcquisition: Boolean(operations),
      nomadConfigured: Boolean(deployments?.nomad.address), imageHostConfigured: Boolean(deployments?.registry) };
  }
  if (pathname === '/api/v1/integrations/nomad') {
    expect(request.method === 'GET', 'Expected GET', 405);
    return deployments ? deployments.nomad.connection() : { state: 'not_configured', namespace: 'default' };
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
  if (pathname === '/api/v1/deployments') {
    expect(deployments, 'Deployments are not configured', 503);
    if (request.method === 'GET') return { deployments: await deployments.list() };
    expect(request.method === 'POST', 'Expected GET or POST', 405);
    return deployments.stage(await readSettings(request), preview(searchParams), request.headers['idempotency-key']);
  }
  const deployment = /^\/api\/v1\/deployments\/([^/]+)(?:\/(start|stop|update|rollback|evaluations|history))?$/.exec(pathname);
  if (deployment) {
    expect(deployments, 'Deployments are not configured', 503);
    const [, nodeId, action] = deployment;
    if (action === 'history') {
      expect(request.method === 'GET', 'Expected GET', 405);
      return { history: await deployments.history(nodeId) };
    }
    if (action === 'evaluations') {
      expect(request.method === 'GET', 'Expected GET', 405);
      return { evaluations: await deployments.evaluations(nodeId) };
    }
    expect(request.method === (action ? 'POST' : 'GET'), 'Invalid deployment request method', 405);
    return action ? deployments.change(nodeId, action, await readSettings(request), preview(searchParams)) : deployments.status(nodeId);
  }
  if (pathname === '/api/v1/releases') {
    if (request.method !== 'GET') throw new RequestError(405, 'Expected GET');
    return { releases: await catalog.list(searchParams.get('prerelease') === 'true') };
  }
  const match = /^\/api\/v1\/(releases|retained)\/([^/]+)\/([^/]+)(\/validate)?$/.exec(pathname);
  if (!match) throw new RequestError(404, 'Unknown route');
  const [, collection, driverId, rawVersion, validate] = match;
  let version;
  try {
    version = decodeURIComponent(rawVersion);
  } catch {
    throw new RequestError(400, 'Malformed release version');
  }
  if (collection === 'retained' && !validate && request.method === 'PUT') {
    return acquire(request, operations, 'retain', { driverId, version }, async () => {
      const retained = await catalog.retain(driverId, version, store);
      if (!retained) throw new RequestError(404, 'Unknown upstream release');
      return retained;
    });
  }
  const method = validate ? 'POST' : 'GET';
  if (request.method !== method) throw new RequestError(405, `Expected ${method}`);
  const settings = validate ? await readSettings(request) : null;
  const source = collection === 'retained' ? store : catalog;
  const release = await source.load(driverId, version);
  if (!release) throw new RequestError(404, 'Unknown driver release');
  return validate ? validateSettings(release.configuration, settings) : release;
}

function authorize(request, token, viewerToken) {
  if (token) {
    const digest = value => createHash('sha256').update(value).digest();
    const provided = digest(request.headers.authorization ?? '');
    if (timingSafeEqual(provided, digest(`Bearer ${token}`))) return 'admin';
    expect(viewerToken && timingSafeEqual(provided, digest(`Bearer ${viewerToken}`)), 'Authorization required', 401);
    const { pathname, searchParams } = new URL(request.url, 'http://localhost');
    const validation = /^\/api\/v1\/(retained|releases)\/[^/]+\/[^/]+\/validate$/.test(pathname);
    const plan = /^\/api\/v1\/deployments(?:\/[^/]+\/(?:start|stop|update|rollback))?$/.test(pathname) &&
      searchParams.get('dryRun') === 'true';
    expect(request.method === 'GET' || (request.method === 'POST' && (validation || plan)),
      'This operation requires administrator access', 403, 'admin_required');
    return 'viewer';
  } else {
    expect(/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(request.headers.host ?? ''),
      'Invalid management host', 403);
    if (request.headers.origin) {
      expect(request.headers.origin === `http://${request.headers.host}`, 'Cross-origin request denied', 403);
    }
  }
  return 'admin';
}

export function createApi(catalog, store, services = {}) {
  return createServer(async (request, response) => {
    let status = 200;
    let body;
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    try {
      const access = authorize(request, services.token, services.viewerToken);
      body = await route(request, catalog, store, services, access);
      if (body instanceof Accepted) {
        body = body.operation;
        status = 202;
        headers.Location = `/api/v1/operations/${body.id}`;
        headers['Preference-Applied'] = 'respond-async';
      }
    } catch (error) {
      ({ status, ...body } = publicError(error));
      if (status === 500) console.error('Driver Hub request failed:', error?.code ?? error?.name ?? 'unknown');
    }
    response.writeHead(status, headers);
    response.end(JSON.stringify(body));
  });
}
