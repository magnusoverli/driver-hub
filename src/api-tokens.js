import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from './errors.js';

const roles = ['admin', 'viewer'];
const idPattern = /^[0-9a-f]{32}$/;
// The token is 32 random bytes, so a single SHA-256 is enough to make a stolen store useless.
const digest = value => createHash('sha256').update(value).digest('hex');
const visible = ({ id, name, role, createdAt, createdBy }) => ({ id, name, role, createdAt, createdBy });

function validName(value) {
  return typeof value === 'string' && value.trim() === value && [...value].length >= 1 && [...value].length <= 80 &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

// Bearer tokens for scripts and automation, created and revoked by administrators. Only a hash of
// each token is stored; the token itself is returned once, when it is created.
export class ApiTokens {
  static async open(directory) {
    const tokens = new ApiTokens();
    tokens.directory = directory;
    tokens.path = join(directory, 'api-tokens.json');
    tokens.records = new Map();
    tokens.pending = Promise.resolve();
    let data;
    try { data = await readFile(tokens.path, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return tokens;
    }
    const store = JSON.parse(data);
    if (store.version !== 1 || !Array.isArray(store.tokens)) throw new Error('Invalid API token store');
    for (const record of store.tokens) {
      if (!idPattern.test(record.id) || tokens.records.has(record.id) || !validName(record.name) ||
          !roles.includes(record.role) || !/^[0-9a-f]{64}$/.test(record.hash) || Number.isNaN(Date.parse(record.createdAt)) ||
          (record.createdBy !== null && typeof record.createdBy !== 'string')) throw new Error('Invalid API token record');
      tokens.records.set(record.id, record);
    }
    return tokens;
  }

  list() { return [...this.records.values()].map(visible); }

  // The role of an "Authorization: Bearer <token>" header value, or null.
  role(authorization) {
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    if (!token) return null;
    const hash = digest(token);
    for (const record of this.records.values()) if (record.hash === hash) return record.role;
    return null;
  }

  create({ name, role, ...rest }, createdBy = null) {
    return this.serialized(async () => {
      expect(!Object.keys(rest).length, 'Unknown API token field');
      expect(validName(name), 'Enter a name of 1 to 80 characters without leading or trailing spaces');
      expect(roles.includes(role), 'Role must be admin or viewer');
      expect(![...this.records.values()].some(r => r.name.toLowerCase() === name.toLowerCase()),
        'An API token with this name already exists', 409, 'token_name_taken');
      const token = `dh_${randomBytes(32).toString('base64url')}`;
      const record = { id: randomBytes(16).toString('hex'), name, role, hash: digest(token),
        createdAt: new Date().toISOString(), createdBy };
      await this.persist(new Map(this.records).set(record.id, record));
      return { ...visible(record), token };
    });
  }

  remove(id) {
    return this.serialized(async () => {
      expect(this.records.has(id), 'Unknown API token', 404);
      const records = new Map(this.records);
      records.delete(id);
      await this.persist(records);
      return { id, deleted: true };
    });
  }

  serialized(fn) {
    const run = this.pending.then(fn);
    this.pending = run.catch(() => {});
    return run;
  }

  async persist(records) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const tmp = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify({ version: 1, tokens: [...records.values()] }), { mode: 0o600, flag: 'wx' });
      await rename(tmp, this.path);
      this.records = records;
    } finally { await rm(tmp, { force: true }); }
  }
}
