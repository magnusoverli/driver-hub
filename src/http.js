import { createServer } from 'node:http';
import { UpstreamError } from './github.js';
import { InvalidRelease } from './release.js';
import { isObject, validateSettings } from './settings.js';

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

async function route(request, catalog) {
  const { pathname, searchParams } = new URL(request.url, 'http://localhost');
  if (pathname === '/api/v1/releases') {
    if (request.method !== 'GET') throw new RequestError(405, 'Expected GET');
    return { releases: await catalog.list(searchParams.get('prerelease') === 'true') };
  }
  const match = /^\/api\/v1\/releases\/([^/]+)\/([^/]+)(\/validate)?$/.exec(pathname);
  if (!match) throw new RequestError(404, 'Unknown route');
  const [, driverId, rawVersion, validate] = match;
  let version;
  try {
    version = decodeURIComponent(rawVersion);
  } catch {
    throw new RequestError(400, 'Malformed release version');
  }
  const method = validate ? 'POST' : 'GET';
  if (request.method !== method) throw new RequestError(405, `Expected ${method}`);
  const settings = validate ? await readSettings(request) : null;
  const release = await catalog.load(driverId, version);
  if (!release) throw new RequestError(404, 'Unknown driver release');
  return validate ? validateSettings(release.configuration, settings) : release;
}

export function createApi(catalog) {
  return createServer(async (request, response) => {
    let status = 200;
    let body;
    try {
      body = await route(request, catalog);
    } catch (error) {
      if (error instanceof RequestError) status = error.status;
      else if (error instanceof InvalidRelease) status = 422;
      else if (error instanceof UpstreamError) status = 502;
      else status = 500;
      body = { error: status === 500 ? 'Internal server error' : error.message };
    }
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  });
}
