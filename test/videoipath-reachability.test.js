import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { checkVideoIPathEndpoint } from '../src/videoipath-reachability.js';

test('endpoint check reaches the protected route without opening a driver session', async t => {
  const ids = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    ids.push(url.searchParams.get('node_id'));
    res.writeHead(url.pathname !== '/x-driver/v1' || !ids.at(-1) ? 404 :
      req.headers.authorization || req.headers.upgrade ? 400 : 401).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `ws://127.0.0.1:${server.address().port}/x-driver/v1`;
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await checkVideoIPathEndpoint(endpoint), { endpoint, state: 'auth_required', httpStatus: 401 });
  }
  assert.match(ids[0], /^[a-f0-9-]{36}$/);
  assert.notEqual(ids[0], ids[1]);
});
