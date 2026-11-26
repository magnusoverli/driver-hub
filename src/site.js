import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { expect } from './errors.js';
import { Nomad } from './nomad.js';

function endpoint(value, service) {
  expect(typeof value === 'string' && value.length > 0 && value.length <= 2048 &&
    !/[\s\\?#@]/.test(value), 'Expected a site IP address or hostname');
  const explicit = value.includes('://');
  const host = isIP(value) === 6 ? `[${value}]` : value;
  let url;
  try { url = new URL(explicit ? value : `https://${host}`); } catch { expect(false, 'Invalid endpoint address'); }
  const vip = service === 'videoipath';
  expect((vip ? ['wss:', 'https:'] : ['http:', 'https:']).includes(url.protocol) &&
    (url.pathname === '/' || (vip && url.pathname === '/x-driver/v1')), 'Invalid endpoint protocol or path');
  if (vip) return `wss://${url.host}/x-driver/v1`;
  if (!explicit && !url.port && !host.endsWith(':443')) url.port = '4646';
  return url.origin;
}

function credential(value) {
  expect(typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/\s/.test(value),
    'Expected a non-empty bearer token');
  return value;
}

const tokenKey = value => createHash('sha256').update(value).digest('hex');

function videoProfile(old, input, url) {
  const prior = old.videoipath?.url === url ? old.videoipath : null;
  const mode = input.tokenMode ?? prior?.mode ?? 'per-device';
  expect(['per-device', 'shared'].includes(mode), 'Invalid token mode');
  const same = prior?.mode === mode;
  if (mode === 'shared') {
    expect(input.tokens === undefined, 'Shared mode takes one token');
    const token = input.token === undefined && same ? prior.token : credential(input.token);
    expect(!old.used[tokenKey(token)] || old.used[tokenKey(token)] === 'shared',
      'A token assigned to an individual device cannot become a shared token', 409);
    return { mode, token, url, id: same && prior.token === token ? prior.id : randomUUID().replaceAll('-', '') };
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
  return { mode, tokens: [...tokens], url, id: same ? prior.id : randomUUID().replaceAll('-', '') };
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
  static async open(directory, defaults, { keyFile, client = settings =>
    new Nomad(settings.address, settings.token, settings.namespace) } = {}) {
    const site = new Site();
    site.directory = directory;
    site.file = join(directory, 'site.enc');
    site.keyFile = keyFile;
    site.client = client;
    site.pending = Promise.resolve();
    let bytes;
    try { bytes = await readFile(site.file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (bytes) {
      const decipher = createDecipheriv('aes-256-gcm', await keyFor(directory, keyFile, false), bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      site.state = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
    } else {
      site.state = { revision: 0, nomad: defaults, videoipath: null, used: {} };
    }
    return site;
  }

  describe() {
    const { revision, nomad, videoipath, used } = this.state;
    const tokens = videoipath?.tokens;
    return { revision, nomad: { address: nomad.address ?? null, namespace: nomad.namespace,
      datacenters: nomad.datacenters, tokenConfigured: Boolean(nomad.token) },
    videoipath: { url: videoipath?.url ?? null, tokenMode: videoipath?.mode ?? 'per-device',
      tokenConfigured: Boolean(videoipath?.token || tokens?.length),
      assignments: (tokens ?? []).map(tokenKey).filter(hash => used[hash]).map(hash => ({
        nodeId: used[hash], tokenFingerprint: hash
      })),
      availableTokens: tokens ? tokens.filter(t => !used[tokenKey(t)]).length : null } };
  }

  serialized(fn) {
    const update = this.pending.then(fn);
    this.pending = update.catch(() => {});
    return update;
  }

  configure(service, input) { return this.serialized(() => this.save(service, input)); }

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

  async save(service, input) {
    const old = this.state;
    const allowed = service === 'nomad' ? ['namespace', 'datacenters'] : ['tokenMode', 'tokens'];
    expect(Object.keys(input).every(key => ['revision', 'address', 'token', ...allowed].includes(key)),
      'Unknown site configuration field');
    expect(input.revision === old.revision, 'Reload the current site settings', 409, 'revision_conflict',
      { currentRevision: old.revision });
    const next = { ...old, revision: old.revision + 1 };
    const address = endpoint(input.address, service);
    if (service === 'nomad') {
      const namespace = input.namespace ?? old.nomad.namespace;
      const datacenters = input.datacenters ?? old.nomad.datacenters;
      expect(typeof namespace === 'string' && /^[a-zA-Z0-9_-]+$/.test(namespace), 'Invalid Nomad namespace');
      expect(Array.isArray(datacenters) && datacenters.length && datacenters.every(dc =>
        typeof dc === 'string' && /^[\w.*-]+$/.test(dc)), 'Expected Nomad datacenters');
      const same = address === old.nomad.address && namespace === old.nomad.namespace;
      const token = input.token === undefined && same ? old.nomad.token : input.token == null ? null : credential(input.token);
      next.nomad = { address, namespace, datacenters, token };
      if (token) requireSecureNomad(address);
      const status = await this.client(next.nomad).connection();
      expect(status.state === 'connected', 'Nomad has no elected leader', 409, 'nomad_not_ready');
      // Never carry the VideoIPath credential to a different configured cluster/namespace.
      if (old.nomad.address && !same) next.videoipath = null;
    } else {
      expect(service === 'videoipath', 'Unknown site setting', 404);
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

export function requireSecureNomad(address) {
  const url = new URL(address);
  expect(url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'Use HTTPS to send credentials to a remote Nomad endpoint', 422);
}
