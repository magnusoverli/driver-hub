import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from './errors.js';
import { publicError } from './public-error.js';
import { fingerprint, uuidPattern } from './request-key.js';

const now = () => new Date().toISOString();

// A manager owns its operations directory. A restart never replays work whose
// side effects may already have committed (particularly a customer build).
export class Operations {
  constructor(root) {
    this.root = root;
    this.instance = randomUUID();
    this.active = 0;
    this.unrecorded = new Map();
  }

  path(id) {
    expect(typeof id === 'string' && uuidPattern.test(id), 'Expected a lowercase UUID operation key');
    return join(this.root, `${id}.json`);
  }

  view(record) {
    const { owner, hash, ...result } = record;
    if (record.state === 'running' && owner !== this.instance) result.state = 'interrupted';
    return result;
  }

  async read(id) {
    if (this.unrecorded.has(id)) return this.unrecorded.get(id);
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async get(id) {
    const record = await this.read(id);
    expect(record, 'Unknown operation', 404);
    return this.view(record);
  }

  async list() {
    await mkdir(this.root, { recursive: true });
    const recent = [];
    for (const file of await readdir(this.root)) {
      if (!file.endsWith('.json') || !uuidPattern.test(file.slice(0, -5))) continue;
      recent.push(await this.get(file.slice(0, -5)));
    }
    return recent.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50);
  }

  async write(record, first = false) {
    await mkdir(this.root, { recursive: true });
    const temp = join(this.root, `${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      if (first) await link(temp, this.path(record.id));
      else await rename(temp, this.path(record.id));
    } finally {
      await rm(temp, { force: true });
    }
  }

  async start(kind, input, key, run) {
    const id = key ?? randomUUID();
    const hash = fingerprint(kind, input);
    const same = record => {
      expect(record.hash === hash, 'Operation key already used for another request', 409, 'operation_key_conflict');
      return this.view(record);
    };
    const existing = await this.read(id);
    if (existing) return same(existing);
    expect(this.active < 4, 'Too many active operations', 429);
    this.active++;
    const target = {};
    for (const field of ['driverId', kind === 'build' ? 'commit' : 'version']) {
      if (typeof input[field] === 'string' && /^[\w.+-]{1,128}$/.test(input[field])) target[field] = input[field];
    }
    const record = { id, kind, target, state: 'running', startedAt: now(), owner: this.instance, hash };
    try {
      await this.write(record, true);
    } catch (error) {
      this.active--;
      if (error.code === 'EEXIST') return same(await this.read(id));
      throw error;
    }
    const accepted = this.view(record);
    void this.finish(record, run).catch(() => {
      // The work may have succeeded; a failed journal write must not cause a replay.
      this.unrecorded.set(id, record);
      console.error(`Could not persist outcome for Driver Hub operation ${id}`);
    }).finally(() => { this.active--; });
    return accepted;
  }

  async finish(record, run) {
    try {
      const { record: release } = await run();
      record.state = 'succeeded';
      record.release = { driverId: release.driverId, version: release.version, digest: release.image.digest };
    } catch (error) {
      record.state = 'failed';
      record.failure = publicError(error);
    }
    record.finishedAt = now();
    await this.write(record);
  }
}
