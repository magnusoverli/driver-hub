import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { expect } from './errors.js';
import { Nomad, requireSecureNomad } from './nomad.js';
import { DeploymentJournal } from './deployment-journal.js';
import { parseAddress } from './image-distribution.js';

function endpoint(value, service) {
  expect(typeof value === 'string' && value.length > 0 && value.length <= 2048 &&
    !/[\s\\?#@]/.test(value), 'Expected a site IP address or hostname');
  const explicit = value.includes('://');
  const host = isIP(value) === 6 ? `[${value}]` : value;
  let url;
  const vip = service === 'videoipath';
  try { url = new URL(explicit ? value : `${vip ? 'wss' : 'https'}://${host}`); } catch { expect(false, 'Invalid endpoint address'); }
  expect((vip ? ['ws:', 'http:', 'wss:', 'https:'] : ['http:', 'https:']).includes(url.protocol) &&
    (url.pathname === '/' || (vip && url.pathname === '/x-driver/v1')), 'Invalid endpoint protocol or path');
  if (vip) return `${['https:', 'wss:'].includes(url.protocol) ? 'wss' : 'ws'}://${url.host}/x-driver/v1`;
  if (!explicit && !url.port && !host.endsWith(':443')) url.port = '4646';
  return url.origin;
}

function credential(value) {
  expect(typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/\s/.test(value),
    'Expected a non-empty bearer token');
  return value;
}

const tokenKey = value => createHash('sha256').update(value).digest('hex');

// A site that has never been saved: no cluster, no VideoIPath target, every optional behaviour off.
const initialState = () => ({
  revision: 0, videoipath: null, used: {},
  nomad: { address: null, token: null, namespace: 'default', datacenters: ['dc1'], plainHttp: false },
  deployment: { nomadUiOrigin: null, sharedWriters: false },
  manager: { buildsEnabled: false, timings: false }
});

// The fields each part of the site settings accepts, besides the revision.
const fields = {
  nomad: ['address', 'token', 'namespace', 'datacenters', 'plainHttp', 'distributionAddress'],
  videoipath: ['address', 'token', 'tokenMode', 'tokens'],
  deployment: ['nomadUiOrigin', 'sharedWriters'],
  manager: ['buildsEnabled', 'timings']
};

function uiOrigin(value) {
  let url;
  try { url = new URL(value); } catch { expect(false, 'Expected an HTTP or HTTPS address for the Nomad web interface'); }
  expect(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' &&
    !url.search && !url.hash, 'Expected an HTTP or HTTPS address for the Nomad web interface, without a path');
  return url.origin;
}

function flag(value) {
  expect(typeof value === 'boolean', 'Expected true or false');
  return value;
}

// Undefined keeps the saved value; null clears an optional one.
function choose(input, old, key, parse) {
  if (input[key] === undefined) return old[key];
  return input[key] === null && parse !== flag ? null : parse(input[key]);
}

function videoProfile(old, input, url) {
  const prior = old.videoipath;
  const mode = input.tokenMode ?? prior?.mode ?? 'per-device';
  expect(['per-device', 'shared'].includes(mode), 'Invalid token mode');
  const same = prior?.mode === mode;
  if (mode === 'shared') {
    expect(input.tokens === undefined, 'Shared mode takes one token');
    const token = input.token === undefined && same ? prior.token : credential(input.token);
    expect(!old.used[tokenKey(token)] || old.used[tokenKey(token)] === 'shared',
      'A token assigned to an individual device cannot become a shared token', 409);
    return { mode, token, url, id: same && prior.url === url && prior.token === token ? prior.id : randomUUID().replaceAll('-', '') };
  }
  expect(input.token === undefined || input.tokens === undefined, 'Supply token or tokens, not both');
  const additions = input.token === undefined ? input.tokens ?? [] : [input.token];
  expect(Array.isArray(additions), 'Expected a list of pre-issued driver tokens');
  const tokens = new Set(same ? prior.tokens : []);
  for (const item of additions) {
    const value = credential(item);
    expect(old.used[tokenKey(value)] !== 'shared', 'A shared token cannot become a per-device token', 409);
    tokens.add(value);
  }
  return { mode, tokens: [...tokens], url, id: same && prior.url === url ? prior.id : randomUUID().replaceAll('-', '') };
}

// Link publishes a completely written key without replacing a key won by another writer.
async function keyFor(directory, mountedKey, create) {
  const file = mountedKey || join(directory, 'site.key');
  try {
    const key = await readFile(file);
    if (key.length !== 32) throw new Error('Site key file must contain exactly 32 bytes');
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT' || mountedKey || !create) throw error;
  }
  const tmp = join(directory, `${randomUUID()}.key`);
  try {
    await writeFile(tmp, randomBytes(32), { flag: 'wx', mode: 0o600 });
    try { await link(tmp, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { await rm(tmp, { force: true }); }
  return keyFor(directory, mountedKey, false);
}

export class Site {
  // `initial` overrides parts of the state of a site that has never been saved.
  // `buildsAvailable` says whether this manager's image can run source builds at all.
  static async open(directory, initial = {}, { keyFile, buildsAvailable = false, client = settings =>
    new Nomad(settings.address, settings.token, settings.namespace, fetch, { plainHttp: settings.plainHttp }) } = {}) {
    const site = new Site();
    site.directory = directory;
    site.journal = await DeploymentJournal.open(join(directory, 'deployments'));
    site.file = join(directory, 'site.enc');
    site.keyFile = keyFile;
    site.client = client;
    site.buildsAvailable = buildsAvailable;
    site.pending = Promise.resolve();
    let bytes;
    try { bytes = await readFile(site.file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const fresh = initialState();
    if (bytes) {
      const decipher = createDecipheriv('aes-256-gcm', await keyFor(directory, keyFile, false), bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      site.state = { ...fresh, ...JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])) };
    } else {
      site.state = { ...fresh, ...Object.fromEntries(Object.entries(initial).map(([part, values]) =>
        [part, { ...fresh[part], ...values }])) };
    }
    return site;
  }

  describe() {
    const { revision, nomad, videoipath, used, deployment, manager } = this.state;
    const tokens = videoipath?.tokens;
    return { revision, nomad: { address: nomad.address ?? null, namespace: nomad.namespace,
      distributionAddress: nomad.distributionAddress ?? null,
      datacenters: nomad.datacenters, tokenConfigured: Boolean(nomad.token), plainHttp: Boolean(nomad.plainHttp) },
    deployment: { nomadUiOrigin: deployment.nomadUiOrigin, sharedWriters: deployment.sharedWriters },
    manager: { ...manager, buildsAvailable: this.buildsAvailable },
    videoipath: { url: videoipath?.url ?? null, tokenMode: videoipath?.mode ?? 'per-device',
      tokenConfigured: Boolean(videoipath?.token || tokens?.length),
      assignments: (tokens ?? []).map(tokenKey).filter(hash => used[hash]).map(hash => ({
        nodeId: used[hash], tokenFingerprint: hash
      })),
      availableTokens: tokens ? tokens.filter(t => !used[tokenKey(t)]).length : null,
      pool: (tokens ?? []).map(t => ({ tokenFingerprint: tokenKey(t), nodeId: used[tokenKey(t)] ?? null })) } };
  }

  serialized(fn) {
    const update = this.pending.then(fn);
    this.pending = update.catch(() => {});
    return update;
  }

  configure(service, input, beforeSwitch, setupHost) {
    return this.serialized(() => this.save(service, input, beforeSwitch, setupHost));
  }

  // Removes a per-device token from the pool by fingerprint: an unused one, or one reserved for a
  // device whose deployment no longer exists (`released` decides that). Revocation stays in VideoIPath.
  removeToken(fingerprint, revision, released) {
    return this.serialized(async () => {
      const old = this.state;
      expect(revision === old.revision, 'Reload the current site settings', 409, 'revision_conflict',
        { currentRevision: old.revision });
      const profile = old.videoipath;
      expect(profile?.mode === 'per-device', 'Only per-device tokens can be removed from a pool', 409);
      const token = profile.tokens.find(t => tokenKey(t) === fingerprint);
      expect(token, 'Unknown token fingerprint', 404);
      const nodeId = old.used[fingerprint];
      if (nodeId) expect(await released(nodeId), 'The token is reserved for an existing deployment', 409, 'token_in_use',
        { nodeId });
      const used = { ...old.used };
      delete used[fingerprint];
      await this.persist({ ...old, revision: old.revision + 1, used,
        videoipath: { ...profile, tokens: profile.tokens.filter(t => t !== token) } });
      return this.describe();
    });
  }

  checkAvailable(profileId, nodeId) {
    const { videoipath: profile, used } = this.state;
    expect(profile?.id === profileId, 'Site target changed; reload and retry staging', 409, 'site_changed');
    if (profile.mode === 'shared') return profile.token;
    const token = profile.tokens.find(t => used[tokenKey(t)] === nodeId) ?? profile.tokens.find(t => !used[tokenKey(t)]);
    expect(token, 'Add an unused external-driver token to the site', 409, 'driver_token_pool_empty');
    return token;
  }

  claim(profileId, nodeId) {
    return this.serialized(async () => {
      const token = this.checkAvailable(profileId, nodeId);
      const { used } = this.state;
      if (used[tokenKey(token)]) return token;
      await this.persist({ ...this.state, revision: this.state.revision + 1, used: { ...used, [tokenKey(token)]: nodeId } });
      return token;
    });
  }

  async save(service, input, beforeSwitch, setupHost) {
    const old = this.state;
    expect(Object.hasOwn(fields, service), 'Unknown site setting', 404);
    expect(Object.keys(input).every(key => key === 'revision' || fields[service].includes(key)),
      'Unknown site configuration field');
    expect(input.revision === old.revision, 'Reload the current site settings', 409, 'revision_conflict',
      { currentRevision: old.revision });
    const next = { ...old, revision: old.revision + 1 };
    if (service === 'deployment') {
      next.deployment = { nomadUiOrigin: choose(input, old.deployment, 'nomadUiOrigin', uiOrigin),
        sharedWriters: choose(input, old.deployment, 'sharedWriters', flag) };
    } else if (service === 'manager') {
      expect(input.buildsEnabled !== true || this.buildsAvailable,
        'This manager cannot reach a working Buildx builder', 409, 'builds_unavailable');
      next.manager = { buildsEnabled: choose(input, old.manager, 'buildsEnabled', flag),
        timings: choose(input, old.manager, 'timings', flag) };
    }
    const address = ['nomad', 'videoipath'].includes(service) && endpoint(input.address, service);
    if (service === 'nomad') {
      const namespace = input.namespace ?? old.nomad.namespace;
      const datacenters = input.datacenters ?? old.nomad.datacenters;
      expect(typeof namespace === 'string' && /^[a-zA-Z0-9_-]+$/.test(namespace), 'Invalid Nomad namespace');
      expect(Array.isArray(datacenters) && datacenters.length && datacenters.every(dc =>
        typeof dc === 'string' && /^[\w.*-]+$/.test(dc)), 'Expected Nomad datacenters');
      const same = address === old.nomad.address && namespace === old.nomad.namespace;
      const token = input.token === undefined && same ? old.nomad.token : input.token == null ? null : credential(input.token);
      const plainHttp = choose(input, { plainHttp: Boolean(old.nomad.plainHttp) }, 'plainHttp', flag);
      const { distributionAddress = old.nomad.distributionAddress ?? null } = input;
      if (distributionAddress !== null) parseAddress(distributionAddress);
      next.nomad = { address, namespace, datacenters, token, plainHttp, distributionAddress,
        setupHost: setupHost ?? (same ? old.nomad.setupHost : null) ?? null };
      if (token) requireSecureNomad(address, plainHttp);
      const status = await this.client(next.nomad).connection();
      expect(status.state === 'connected', 'Nomad has no elected leader', 409, 'nomad_not_ready');
      // Never carry the VideoIPath credential to a different configured cluster/namespace.
      if (old.nomad.address && !same) {
        await beforeSwitch?.();
        next.videoipath = null;
      }
    } else if (service === 'videoipath') {
      next.videoipath = videoProfile(old, input, address);
      if (next.videoipath.mode === 'shared') next.used = { ...old.used, [tokenKey(next.videoipath.token)]: 'shared' };
    }
    await this.persist(next);
    return this.describe();
  }

  async persist(next) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await keyFor(this.directory, this.keyFile, true), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(next)), cipher.final()]);
    const tmp = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { flag: 'wx', mode: 0o600 });
      await rename(tmp, this.file);
    } finally { await rm(tmp, { force: true }); }
    this.state = next;
  }
}
