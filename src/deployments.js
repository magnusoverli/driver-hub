import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { expect } from './errors.js';
import { createJob } from './job.js';
import { imageKey } from './images.js';
import { parseTag } from './release.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nil = '00000000-0000-0000-0000-000000000000';

function jobId(nodeId) {
  expect(typeof nodeId === 'string' && uuid.test(nodeId) && nodeId !== nil, 'Expected a lowercase, non-nil node UUID');
  return `driverhub-${nodeId}`;
}

export class Deployments {
  constructor({ nomad, store, images, registry, datacenters }) {
    Object.assign(this, { nomad, store, images, registry, datacenters });
  }

  async list() {
    const jobs = await this.nomad.list();
    return jobs.filter(job => job.Meta?.managed_by === 'driver-hub').map(job => {
      const { nodeId, driverId, version } = JSON.parse(job.Meta.spec);
      return { nodeId, driverId, version, status: job.Status, revision: job.JobModifyIndex };
    });
  }

  async current(nodeId) {
    const job = await this.nomad.get(jobId(nodeId));
    expect(job, 'Unknown deployment', 404);
    expect(job.Meta?.managed_by === 'driver-hub', 'Job belongs to another manager', 409);
    return job;
  }

  async status(nodeId) {
    const job = await this.current(nodeId);
    const allocations = await this.nomad.allocations(job.ID);
    const active = allocations.filter(a => a.DesiredStatus === 'run' && a.ClientStatus === 'running');
    let communication = 'unknown';
    const group = job.TaskGroups[0];
    if (group.Count === 1 && group.Tasks[0].Services?.length && active.length === 1 &&
        active[0].JobVersion === job.Version) {
      const checks = await this.nomad.checks(active[0].ID);
      const observed = Object.values(checks ?? {}).find(c => c.Check === 'driver-communication' && c.Task === 'driver');
      const age = Date.now() / 1000 - observed?.Timestamp;
      if (age >= 0 && age < 30) {
        if (observed.Status === 'success') communication = 'driver-reports-connected';
        if (observed.Status === 'failure') communication = 'check-failed';
      }
    }
    return {
      ...JSON.parse(job.Meta.spec), revision: job.JobModifyIndex,
      requested: job.TaskGroups[0].Count === 1 ? 'running' : 'stopped',
      previousVersion: JSON.parse(job.Meta.previous)?.version ?? null,
      communication, approval: 'unknown',
      allocations: allocations.map(a => ({
        id: a.ID, host: a.NodeName, desired: a.DesiredStatus, status: a.ClientStatus, jobVersion: a.JobVersion
      }))
    };
  }

  async submit(spec, previous, running, migrated, revision) {
    expect(typeof spec.driverId === 'string' && typeof spec.version === 'string' &&
      parseTag(`drivers/${spec.driverId}/v${spec.version}`), 'Invalid driver identity or version');
    expect(typeof this.registry === 'string' && /^[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(this.registry) &&
      (this.registry === 'localhost' || /[.:]/.test(this.registry)),
      'Configure the Driver Hub image distribution address', 503);
    const release = await this.store.load(spec.driverId, spec.version);
    expect(release, 'Release must be retained before deployment', 404);
    const key = imageKey(release.record);
    const image = `${this.registry}/driverhub/${key}@${release.record.image.digest}`;
    const job = createJob({ spec, previous, running, migrated, image, release,
      namespace: this.nomad.namespace, datacenters: this.datacenters });
    await this.images.publish(release.record, this.store.archivePath(spec.driverId, spec.version));
    const result = await this.nomad.submit(job, revision);
    return { nodeId: spec.nodeId, image, ...result };
  }

  async stage(input) {
    const migrated = input.nodeId !== undefined;
    const nodeId = migrated ? input.nodeId : randomUUID();
    expect(!await this.nomad.get(jobId(nodeId)), 'Deployment already exists', 409);
    return this.submit({ nodeId, driverId: input.driverId, version: input.version, settings: input.settings ?? {} },
      null, false, migrated, 0);
  }

  async change(nodeId, action, input) {
    const job = await this.current(nodeId);
    expect(Number.isSafeInteger(input.revision) && input.revision === job.JobModifyIndex,
      'Supply the current deployment revision', 409);
    let spec = JSON.parse(job.Meta.spec);
    let previous = JSON.parse(job.Meta.previous);
    let migrated = job.Meta.migrated === 'true';
    let running = job.TaskGroups[0].Count === 1;
    if (action === 'start') {
      expect(!migrated || input.originalStopped === true, 'Confirm the original external driver has stopped', 409);
      migrated = false;
      running = true;
    } else if (action === 'stop') {
      // Stopping must work even if release files or image storage are unavailable.
      job.TaskGroups[0].Count = 0;
      return { nodeId, ...await this.nomad.submit(job, input.revision) };
    } else if (action === 'update') {
      const next = { ...spec, version: input.version, settings: input.settings ?? spec.settings };
      if (isDeepStrictEqual(next, spec)) return { nodeId, revision: job.JobModifyIndex, unchanged: true };
      previous = spec;
      spec = next;
    } else if (action === 'rollback') {
      expect(previous, 'No previous deployment configuration', 409);
      [spec, previous] = [previous, spec];
    } else {
      expect(false, 'Unknown deployment action', 404);
    }
    return this.submit(spec, previous, running, migrated, input.revision);
  }
}
