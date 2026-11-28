import assert from 'node:assert/strict';
import test from 'node:test';
import { deployForm } from '../src/deployment-inputs.js';
import { createJob } from '../src/job.js';
import { checkDeclaration, validateSettings } from '../src/settings.js';

// Shaped like a driver from the VideoIPath External Drivers repository: the VideoIPath connection
// and node ID declared as inputs, descriptions, length bounds (also on the secret token), and a
// control-health endpoint.
const declaration = () => ({
  schemaVersion: 1,
  controlHealth: { port: 8080, path: '/control' },
  inputs: [
    { name: 'videoipathUrl', type: 'string', required: true, minLength: 1, env: 'VIDEOIPATH_URL',
      description: 'Complete wss:// endpoint ending in /x-driver/v1.' },
    { name: 'videoipathToken', type: 'string', required: true, secret: true, minLength: 1, maxLength: 8192,
      env: 'VIDEOIPATH_TOKEN', description: 'Bearer token created in the VideoIPath CLI.' },
    { name: 'nodeId', type: 'string', required: true, minLength: 1, env: 'VIDEOIPATH_NODE_ID',
      description: 'Stable UUID of this device.' },
    { name: 'deviceHost', type: 'string', required: true, minLength: 1, maxLength: 253, env: 'DEVICE_HOST',
      description: 'Host name or IP address of the device.' },
    { name: 'logLevel', type: 'string', required: false, default: 'info', maxLength: 8, env: 'DRIVER_LOG_LEVEL' },
    { name: 'shutdownTimeoutMs', type: 'integer', required: false, default: 4000, minimum: 100, maximum: 4500,
      env: 'DRIVER_SHUTDOWN_TIMEOUT_MS', description: 'How long a shutdown may take.' }
  ]
});

const site = { id: 'site1', url: 'wss://vip.site.example/x-driver/v1', mode: 'per-device' };
const nodeId = '087aa0f0-8ee9-49f0-aa74-127014499fc1';

test('release-specific constraints apply to manual and inherited values without driver ID heuristics', () => {
  const config = declaration();
  config.schemaVersion = 2;
  const field = config.inputs[0];
  field.url = { schemes: ['wss'], path: '/x-driver/v1', allowCredentials: false, allowQuery: false, allowFragment: false };
  config.inputs[4].enum = ['info', 'debug'];
  const ws = { ...site, url: site.url.replace('wss:', 'ws:') };
  const errors = (p, settings) => deployForm(checkDeclaration(config), { settings }, p).validation.errors;
  assert.ok(errors(ws, {}).some(e => e.code === 'unsupported_url_scheme'));
  for (const url of ['https://host/x-driver/v1', 'wss://u:p@host/x-driver/v1', 'wss://host/other',
    'wss://host/x-driver/v1?', 'wss://host/x-driver/v1#']) {
    assert.ok(errors(null, { videoipathUrl: url }).some(e => e.field === field.name));
  }
  field.url.schemes = ['ws'];
  assert.ok(!errors(ws, {}).some(e => e.field === field.name));
  assert.ok(errors(site, {}).some(e => e.code === 'unsupported_url_scheme'));
  assert.ok(errors(ws, { logLevel: 'INFO' }).some(e => e.code === 'not_in_enum'));
  config.inputs[4].default = 'typo';
  assert.throws(() => checkDeclaration(config), /default/);
  assert.throws(() => checkDeclaration({ ...config, schemaVersion: 1 }), /property/);
});

test('a declaration with descriptions and length bounds, also on secrets, is accepted as published', () => {
  const checked = checkDeclaration(declaration());
  assert.equal(checked.inputs[0].description, 'Complete wss:// endpoint ending in /x-driver/v1.');

  const form = deployForm(checked, {}, site);
  assert.deepEqual(form.fields.filter(f => f.source !== 'operator').map(f => [f.name, f.source]),
    [['videoipathUrl', 'site'], ['videoipathToken', 'site'], ['nodeId', 'identity']]);
  // The deploy form carries descriptions to the operator, and is complete without operator values
  // except the required device host.
  assert.equal(form.fields.find(f => f.name === 'deviceHost').description, 'Host name or IP address of the device.');
  assert.deepEqual(form.validation.errors, [{ field: 'deviceHost', code: 'required' }]);
});

test('string length bounds apply to values the operator enters, never to a secret Hub does not see', () => {
  const checked = checkDeclaration(declaration());
  const settings = { videoipathUrl: 'wss://vip/x-driver/v1', nodeId, videoipathToken: { secretRef: 'vip_token' } };
  assert.deepEqual(validateSettings(checked, { ...settings, deviceHost: 'meter.site.example' }).errors, []);
  assert.deepEqual(validateSettings(checked, { ...settings, deviceHost: 'm'.repeat(254) }).errors,
    [{ field: 'deviceHost', code: 'too_long' }]);
  assert.deepEqual(validateSettings(checked, { ...settings, deviceHost: '' }).errors,
    [{ field: 'deviceHost', code: 'too_short' }]);
  // The secret's own bounds (1 to 8192) do not apply to the name of its key.
  assert.deepEqual(validateSettings(checked, { ...settings, deviceHost: 'h', videoipathToken: { secretRef: 't' } }).errors, []);
});

test('declarations that break the contract are refused', () => {
  const broken = change => {
    const value = declaration();
    change(value);
    return () => checkDeclaration(value);
  };
  const refusals = [
    [broken(d => { d.inputs[3].label = 'Device'; }), /Unsupported input property/],
    [broken(d => { d.inputs[3].description = ' '; }), /Invalid input description/],
    [broken(d => { d.inputs[3].description = 7; }), /Invalid input description/],
    [broken(d => { d.inputs[3].description = 'x'.repeat(1001); }), /Invalid input description/],
    [broken(d => { d.inputs[5].maxLength = 3; }), /Invalid length bound/],
    [broken(d => { d.inputs[3].maxLength = -1; }), /Invalid length bound/],
    [broken(d => { d.inputs[3].minLength = 10; d.inputs[3].maxLength = 2; }), /Inverted length bounds/],
    [broken(d => { d.inputs[4].default = 'verbose-debug'; }), /Invalid input default/],
    [broken(d => { d.inputs[1].default = 'inline-secret'; }), /Invalid secret declaration/]
  ];
  for (const [run, message] of refusals) assert.throws(run, message);
});

test('driver jobs stop with SIGTERM and give the driver 5 seconds', () => {
  const release = { configuration: checkDeclaration(declaration()),
    record: { image: { platforms: ['linux/amd64'] } } };
  const job = createJob({ spec: { nodeId, settings: { deviceHost: 'meter.site.example' }, videoIPath: site },
    previous: null, running: true, migrated: false, image: '127.0.0.1:5480/driverhub/x@sha256:' + 'a'.repeat(64),
    release, namespace: 'default', datacenters: ['dc1'] });
  const task = job.TaskGroups[0].Tasks[0];
  assert.equal(task.KillSignal, 'SIGTERM');
  assert.equal(task.KillTimeout, 5e9);
  assert.deepEqual(task.Services[0].Checks[0].Path, '/control');
});
