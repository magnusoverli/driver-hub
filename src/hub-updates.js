import { request } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from './errors.js';
import { findUpdate, stable } from './hub-release.js';

export const updating = state => ['downloading', 'restarting', 'verifying', 'rollingBack'].includes(state?.phase);
export function hostCall(socketPath, path, body) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000) }, res => {
      let text = '';
      res.setEncoding('utf8').on('data', chunk => { text += chunk; }).on('error', reject).on('end', () => {
        try {
          expect(res.statusCode === 200, 'The host updater refused the request. Check its status.', 409);
          resolve(JSON.parse(text));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

export class HubUpdates {
  constructor({ root, version, revision, socket, lookup = findUpdate, host = hostCall }) {
    Object.assign(this, { root, version, revision, socket, lookup, host });
    this.expires = 0; this.lastCheck = 0; this.writes = 0; this.starting = false;
  }
  async check(force = false) {
    if (!stable.test(this.version)) return;
    const now = Date.now();
    if (now >= this.expires || (force && now - this.lastCheck >= 60000)) {
      this.pending ??= (async () => {
        this.lastCheck = now;
        try {
          this.candidate = await this.lookup(this.version);
          this.checkError = false;
          this.expires = now + (this.candidate?.readiness === 'publishing' ? 60000 : 6 * 3600000);
        } catch {
          this.checkError = true; this.expires = now + 60000;
        }
      })().finally(() => { this.pending = null; });
    }
    await this.pending;
  }
  pref(user) { return join(this.root, createHash('sha256').update(user).digest('hex')); }
  async helper() {
    if (!this.socket) return null;
    try { return await this.host(this.socket, '/state'); } catch { return null; }
  }
  async status(user, force) {
    const [, state, ignored] = await Promise.all([this.check(force), this.helper(),
      readFile(this.pref(user), 'utf8').catch(e => { if (e.code !== 'ENOENT') throw e; return ''; })]);
    return { installed: this.version, checked: this.lastCheck || null, checkError: !!this.checkError,
      managed: !!state, operation: state?.phase === 'idle' ? null : state, ignored, candidate: this.candidate ?? null };
  }
  async ignore(user, version) {
    expect(stable.test(version) && version === this.candidate?.version, 'Release changed; refresh updates', 409);
    await mkdir(this.root, { recursive: true });
    const path = this.pref(user), tmp = `${path}.${randomUUID()}`;
    await writeFile(tmp, version, { mode: 0o600 }); await rename(tmp, path);
  }
  // Count the entire async request, not just Nomad submissions. Async operations
  // outliving the response are accounted for by Operations.active at admission.
  async write(fn) {
    this.writes++;
    try {
      expect(!this.starting, 'Driver Hub is updating; retry after restart', 503);
      const state = this.socket ? await this.host(this.socket, '/state').catch(() => null) : null;
      expect(!this.socket || state, 'Configured host updater is unavailable; cannot verify maintenance state', 503);
      expect(!this.starting && !updating(state), 'Driver Hub is updating; retry after restart', 503);
      return await fn();
    } finally { this.writes--; }
  }
  async start(version, operations) {
    expect(!this.starting && !this.writes && !operations?.active, 'Another operation is in progress. Try again when it finishes.', 409);
    this.starting = true;
    try {
      await this.check(true);
      expect(this.socket && !this.checkError && this.candidate?.version === version && this.candidate.readiness === 'ready',
        'This release is not ready for managed update', 409);
      await this.host(this.socket, '/update', { version, installed: this.version, digest: this.candidate.digest });
    } finally { this.starting = false; }
  }
}
