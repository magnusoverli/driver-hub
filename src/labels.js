import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from './errors.js';

const maxLength = 80;
const nodeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Undefined leaves a label untouched, null clears it, and a string is trimmed and bounded.
export function normalizeLabel(value) {
  if (value === undefined || value === null) return value;
  expect(typeof value === 'string', 'Expected the label to be a string or null', 400, 'invalid_label');
  const label = value.trim();
  expect(label.length > 0 && [...label].length <= maxLength && !/\p{Cc}/u.test(label),
    `Labels contain 1–${maxLength} characters without control characters`, 400, 'invalid_label');
  return label;
}

// Operator-facing device names. They are presentation data only: Nomad recovers a driver
// without them, and keeping them out of job metadata means renaming never restarts a driver.
export class DeploymentLabels {
  static async open(directory) {
    const labels = new DeploymentLabels();
    labels.directory = directory;
    labels.path = join(directory, 'labels.json');
    labels.entries = new Map();
    labels.pending = Promise.resolve();
    let data;
    try { data = await readFile(labels.path, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return labels;
    }
    const store = JSON.parse(data);
    if (store.version !== 1 || !store.labels || typeof store.labels !== 'object') throw new Error('Invalid deployment label store');
    for (const [nodeId, label] of Object.entries(store.labels)) {
      if (!nodeIdPattern.test(nodeId) || normalizeLabel(label) !== label) throw new Error('Invalid deployment label record');
      labels.entries.set(nodeId, label);
    }
    return labels;
  }

  get(nodeId) { return this.entries.get(nodeId) ?? null; }

  set(nodeId, value) {
    const label = normalizeLabel(value);
    const run = this.pending.then(() => this.save(nodeId, label));
    this.pending = run.catch(() => {});
    return run;
  }

  async save(nodeId, label) {
    expect(nodeIdPattern.test(nodeId), 'Expected a lowercase UUID node ID');
    if (label === undefined || this.get(nodeId) === label) return label ?? this.get(nodeId);
    const entries = new Map(this.entries);
    if (label === null) entries.delete(nodeId); else entries.set(nodeId, label);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const tmp = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify({ version: 1, labels: Object.fromEntries(entries) }), { mode: 0o600, flag: 'wx' });
      await rename(tmp, this.path);
      this.entries = entries;
    } finally { await rm(tmp, { force: true }); }
    return label;
  }
}
