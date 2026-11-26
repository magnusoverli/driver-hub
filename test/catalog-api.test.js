import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { Catalog } from '../src/catalog.js';
import { GitHubReleases } from '../src/github.js';
import { createApi } from '../src/http.js';

const config = {
  schemaVersion: 1,
  inputs: [
    { name: 'host', type: 'string', required: true, minLength: 1, env: 'HOST' },
    { name: 'port', type: 'integer', required: false, minimum: 1, maximum: 65535, default: 443, env: 'PORT' },
    { name: 'credential', type: 'string', required: true, secret: true, file: '/run/secrets/device' }
  ]
};

function fixture() {
  const record = {
    schemaVersion: 1, driverId: 'meter', displayName: 'Example meter', version: '1.0.0',
    source: { commit: 'a'.repeat(40), directory: 'Drivers/Vendor/Example/Meter' },
    configuration: { file: 'driver-config.json', sha256: createHash('sha256').update(JSON.stringify(config)).digest('hex') },
    image: {
      digest: `sha256:${'b'.repeat(64)}`, platforms: ['linux/amd64'],
      archive: 'meter.oci.tar.gz', archiveSha256: 'c'.repeat(64)
    }
  };
  const release = {
    tag_name: 'drivers/meter/v1.0.0', draft: false, prerelease: false,
    assets: ['driver-release.json', 'driver-config.json', record.image.archive]
      .map((name, i) => ({ id: i + 1, name, state: 'uploaded' }))
  };
  const routes = new Map([
    ['/releases?per_page=50&page=1', [
      release, { ...release, draft: true }, { ...release, tag_name: 'v1.2.3' },
      { ...release, tag_name: 'drivers/meter/v1.1.0-rc.1' }, { ...release, assets: [] }
    ]],
    [`/releases/tags/${encodeURIComponent(release.tag_name)}`, release],
    ['/releases/assets/1', record], ['/releases/assets/2', config]
  ]);
  const github = new GitHubReleases(async url => {
    const key = url.slice(url.indexOf('/releases'));
    return routes.has(key) ? Response.json(routes.get(key)) : new Response(null, { status: 404 });
  });
  return { catalog: new Catalog(github), routes, release, record };
}

async function serve(t, catalog) {
  const server = createApi(catalog).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/v1/releases`;
}

test('API discovers published releases, with explicit prerelease opt-in', async t => {
  const base = await serve(t, fixture().catalog);
  const stable = await (await fetch(base)).json();
  assert.deepEqual(stable.releases, [{ driverId: 'meter', version: '1.0.0', prerelease: false }]);
  const all = await (await fetch(`${base}?prerelease=true`)).json();
  assert.equal(all.releases[1].version, '1.1.0-rc.1');
  assert.equal((await fetch(`${base}/meter/2.0.0`)).status, 404);
});

test('API validates the selected release without echoing supplied values', async t => {
  const base = await serve(t, fixture().catalog);
  const detail = await (await fetch(`${base}/meter/1.0.0`)).json();
  assert.deepEqual(detail.configuration, config);
  const post = settings => fetch(`${base}/meter/1.0.0/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings)
  });
  const invalid = await (await post({ port: 70000, credential: 'raw-value', extra: true })).json();
  assert.deepEqual(invalid, { valid: false, errors: [
    { field: 'extra', code: 'unknown_input' }, { field: 'host', code: 'required' },
    { field: 'port', code: 'out_of_range' }, { field: 'credential', code: 'secret_reference_required' }
  ] });
  assert.deepEqual(await (await post({ host: 'device', credential: { secretRef: 'device/key' } })).json(),
    { valid: true, errors: [] });
  assert.equal((await post([])).status, 400);
  assert.equal((await post({ host: 'x'.repeat(65536) })).status, 413);
});

test('mismatched identity, checksum, and missing archive fail closed', async t => {
  const { catalog, routes, release, record } = fixture();
  const url = `${await serve(t, catalog)}/meter/1.0.0`;
  record.version = '1.0.1';
  assert.equal((await fetch(url)).status, 422);
  record.version = '1.0.0';
  routes.set('/releases/assets/2', { schemaVersion: 1, inputs: [] });
  assert.equal((await fetch(url)).status, 422);
  routes.set('/releases/assets/2', config);
  release.assets.pop();
  assert.equal((await fetch(url)).status, 422);
});

test('GitHub outages are distinguishable from an empty catalog', async t => {
  const source = new GitHubReleases(async () => new Response(null, { status: 503 }));
  const base = await serve(t, new Catalog(source));
  assert.equal((await fetch(base)).status, 502);
});

test('release discovery continues past a page of unrelated tags', async () => {
  const { release } = fixture();
  const pages = [];
  const github = new GitHubReleases(async url => {
    const page = new URL(url).searchParams.get('page');
    pages.push(page);
    return Response.json(page === '1' ? Array(50).fill({ tag_name: 'other', draft: false }) : [release]);
  });
  assert.equal((await new Catalog(github).list(false)).length, 1);
  assert.deepEqual(pages, ['1', '2']);
});

test('checksummed but unsupported settings rules are rejected before preflight', async () => {
  const { catalog, record, routes } = fixture();
  const unsupported = structuredClone(config);
  unsupported.inputs[0].pattern = '^example';
  routes.set('/releases/assets/2', unsupported);
  record.configuration.sha256 = createHash('sha256').update(JSON.stringify(unsupported)).digest('hex');
  await assert.rejects(catalog.load('meter', '1.0.0'), /Unsupported input property/);
});
