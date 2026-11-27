import test from 'node:test';
import assert from 'node:assert/strict';
import { backupImageClient, copyReceipt } from '../src/image-distribution.js';

test('handoff requires fresh evidence for the pinned image on a different compatible client', async () => {
  const key = 'a'.repeat(64), digest = `sha256:${'b'.repeat(64)}`, images = [{ key, digest }];
  const job = { TaskGroups: [{ Tasks: [{ Config: { image: `localhost/driverhub/${key}@${digest}` } }],
    Constraints: [{ LTarget: '${attr.cpu.arch}', Operand: 'regexp', RTarget: '^(amd64)$' }] }] };
  const allocation = { ID: 'copy', NodeID: 'backup', TaskGroup: 'images-amd64', DesiredStatus: 'run', ClientStatus: 'running' };
  const check = { Check: 'images-copied', Status: 'success', Output: copyReceipt(images), Timestamp: 100 };
  const client = { variable: async () => ({ Items: { wanted: JSON.stringify({ images }) } }),
    allocations: async () => [allocation], checks: async () => ({ check }) };
  const read = (node = 'primary', now = 100000) => backupImageClient(client, job, { NodeID: node }, now);
  assert.equal(await read(), 'backup');
  assert.equal(await read('backup'), null);
  assert.equal(await read('primary', 140000), null);
  check.Output = copyReceipt([]);
  assert.equal(await read(), null);
  check.Output = copyReceipt(images);
  allocation.TaskGroup = 'images-arm64';
  assert.equal(await read(), null);
});
