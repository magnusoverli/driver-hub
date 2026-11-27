import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fingerprint, uuidPattern } from './request-key.js';

// One manager owns this directory. Per-device records survive ambiguous writes, restarts and
// target changes. Keep only release references and cleanup receipts, never settings or tokens.
export class DeploymentJournal {
  static async open(directory) {
    const journal = new DeploymentJournal();
    journal.directory = directory;
    journal.records = new Map();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const ownerFile = join(directory, 'owner');
    try { await writeFile(ownerFile, randomUUID(), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    journal.owner = await readFile(ownerFile, 'utf8');
    if (!uuidPattern.test(journal.owner)) throw new Error('Invalid deployment journal owner');
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.json')) continue;
      const record = JSON.parse(await readFile(join(directory, name), 'utf8'));
      if (!uuidPattern.test(record.nodeId) || !Array.isArray(record.refs) ||
        `${journal.key(record)}.json` !== name) throw new Error('Invalid deployment journal record');
      journal.records.set(journal.key(record), record);
    }
    return journal;
  }

  key({ target, nodeId }) { return fingerprint('deployment', [target, nodeId]); }
  get(identity) { return this.records.get(this.key(identity)); }

  async save(record) {
    const key = this.key(record);
    const file = join(this.directory, `${key}.json`);
    const tmp = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
      await rename(tmp, file);
      this.records.set(key, record);
    } finally { await rm(tmp, { force: true }); }
  }

  async forget(identity) {
    const key = this.key(identity);
    await rm(join(this.directory, `${key}.json`), { force: true });
    this.records.delete(key);
  }
}
