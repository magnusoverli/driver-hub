import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect } from './errors.js';

const derive = promisify(scrypt);
const usernamePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const roles = ['admin', 'viewer'];
const normalize = value => typeof value === 'string' ? value.toLowerCase() : '';
const visible = ({ username, role, enabled }) => ({ username, role, enabled });

// The v1 store fixes the KDF parameters so an upgrade can identify old hashes.
async function hash(password, salt) {
  return derive(password, Buffer.from(salt, 'hex'), 32, { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
}

export class LocalUsers {
  static async open(directory) {
    const users = new LocalUsers();
    users.directory = directory;
    users.path = join(directory, 'users.json');
    users.records = new Map();
    users.pending = Promise.resolve();
    users.dummySalt = randomBytes(16).toString('hex');
    let data;
    try { data = await readFile(users.path, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return users;
    }
    const store = JSON.parse(data);
    if (store.version !== 1 || !Array.isArray(store.users)) throw new Error('Invalid local account store');
    for (const record of store.users) {
      if (typeof record.username !== 'string' || !usernamePattern.test(record.username) || users.records.has(record.username) ||
          !roles.includes(record.role) || typeof record.enabled !== 'boolean' || !Number.isSafeInteger(record.revision) ||
          !/^[0-9a-f]{32}$/.test(record.salt) || !/^[0-9a-f]{64}$/.test(record.hash)) throw new Error('Invalid local account record');
      users.records.set(record.username, record);
    }
    if (!users.list().some(user => user.enabled && user.role === 'admin')) throw new Error('Missing active local administrator');
    return users;
  }

  list() { return [...this.records.values()].map(visible); }

  resolve(username) {
    const user = this.records.get(username);
    if (user?.enabled) return { username, role: user.role, provider: 'local', revision: user.revision };
    return null;
  }

  async authenticate(username, password) {
    const name = normalize(username);
    const user = this.records.get(name);
    if (typeof password !== 'string' || !password.length || Buffer.byteLength(password) > 1024) return null;
    const actual = await hash(password, user?.salt ?? this.dummySalt);
    const valid = timingSafeEqual(actual, user ? Buffer.from(user.hash, 'hex') : Buffer.alloc(32));
    if (!valid || this.records.get(name) !== user) return null;
    return this.resolve(name);
  }

  create(input) { return this.write(input.username, input, true); }
  update(username, changes, revision) { return this.write(username, changes, false, revision); }

  write(username, changes, create, revision) {
    const run = this.pending.then(() => this.save(normalize(username), changes, create, revision));
    this.pending = run.catch(() => {});
    return run;
  }

  async save(username, changes, create, revision) {
    const allowed = create ? ['username', 'password', 'role'] : ['password', 'role', 'enabled'];
    expect(Object.keys(changes).length && Object.keys(changes).every(key => allowed.includes(key)), 'Invalid account fields');
    expect(usernamePattern.test(username), 'Expected a username of 1–64 letters, digits, periods, underscores or hyphens');
    const current = this.records.get(username);
    if (create) expect(!current, 'Username already exists', 409);
    else expect(current, 'Unknown local account', 404);
    if (revision !== undefined) expect(current?.revision === revision, 'Account changed; sign in again', 409);
    const role = changes.role === undefined ? current?.role : changes.role;
    expect(roles.includes(role), 'Role must be admin or viewer');
    expect(changes.enabled === undefined || typeof changes.enabled === 'boolean', 'Expected boolean enabled');
    const next = { ...current, username, role, enabled: changes.enabled ?? current?.enabled ?? true,
      revision: (current?.revision ?? 0) + 1 };
    if (create || changes.password !== undefined) {
      const password = changes.password;
      expect(typeof password === 'string' && [...password].length >= 12 && Buffer.byteLength(password) <= 1024,
        'Passwords must contain at least 12 characters and at most 1024 UTF-8 bytes');
      next.salt = randomBytes(16).toString('hex');
      next.hash = (await hash(password, next.salt)).toString('hex');
    }
    const records = new Map(this.records).set(username, next);
    expect([...records.values()].some(u => u.enabled && u.role === 'admin'), 'At least one enabled local admin is required', 409);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const tmp = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify({ version: 1, users: [...records.values()] }), { mode: 0o600, flag: 'wx' });
      await rename(tmp, this.path);
      this.records = records;
    } finally { await rm(tmp, { force: true }); }
    return visible(next);
  }
}
