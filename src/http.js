import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { UpstreamError } from './github.js';
import { InvalidRelease } from './release.js';
import { ReleaseConflict } from './release-store.js';
import { isObject, validateSettings } from './settings.js';
import { RequestError, expect } from './errors.js';

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

async function route(request, catalog, store, { deployments, builds }) {
  const { pathname, searchParams } = new URL(request.url, 'http://localhost');
  if (pathname === '/api/v1/retained') {
    expect(request.method === 'GET', 'Expected GET', 405);
    return { releases: await store.list() };
  }
  if (pathname === '/api/v1/builds') {
    expect(request.method === 'POST', 'Expected POST', 405);
    expect(builds, 'Source builds are disabled', 503);
    return builds.create(await readSettings(request));
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
    return deployments.stage(await readSettings(request));
  }
  const deployment = /^\/api\/v1\/deployments\/([^/]+)(?:\/(start|stop|update|rollback))?$/.exec(pathname);
  if (deployment) {
    expect(deployments, 'Deployments are not configured', 503);
    const [, nodeId, action] = deployment;
    expect(request.method === (action ? 'POST' : 'GET'), 'Invalid deployment request method', 405);
    return action ? deployments.change(nodeId, action, await readSettings(request)) : deployments.status(nodeId);
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
    const retained = await catalog.retain(driverId, version, store);
    if (!retained) throw new RequestError(404, 'Unknown upstream release');
    return retained;
  }
  const method = validate ? 'POST' : 'GET';
  if (request.method !== method) throw new RequestError(405, `Expected ${method}`);
  const settings = validate ? await readSettings(request) : null;
  const source = collection === 'retained' ? store : catalog;
  const release = await source.load(driverId, version);
  if (!release) throw new RequestError(404, 'Unknown driver release');
  return validate ? validateSettings(release.configuration, settings) : release;
}

function authorize(request, token) {
  if (token) {
    const digest = value => createHash('sha256').update(value).digest();
    expect(timingSafeEqual(digest(request.headers.authorization ?? ''), digest(`Bearer ${token}`)),
      'Admin authorization required', 401);
  } else {
    expect(/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(request.headers.host ?? ''),
      'Invalid management host', 403);
    if (request.headers.origin) {
      expect(request.headers.origin === `http://${request.headers.host}`, 'Cross-origin request denied', 403);
    }
  }
}

export function createApi(catalog, store, services = {}) {
  return createServer(async (request, response) => {
    let status = 200;
    let body;
    try {
      authorize(request, services.token);
      body = await route(request, catalog, store, services);
    } catch (error) {
      if (error instanceof RequestError) status = error.status;
      else if (error instanceof ReleaseConflict) status = 409;
      else if (error instanceof InvalidRelease) status = 422;
      else if (error instanceof UpstreamError) status = 502;
      else status = 500;
      body = { error: status === 500 ? 'Internal server error' : error.message };
    }
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  });
}
