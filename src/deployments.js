import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { expect, RequestError } from './errors.js';
import { createJob } from './job.js';
import { imageKey } from './images.js';
import { parseTag } from './release.js';
import { placementIssues } from './nomad.js';
import { fingerprint, uuidPattern } from './request-key.js';

const nil = '00000000-0000-0000-0000-000000000000';

function jobId(nodeId) {
  expect(typeof nodeId === 'string' && uuidPattern.test(nodeId) && nodeId !== nil, 'Expected a lowercase, non-nil node UUID');
  return `driverhub-${nodeId}`;
}

async function controlEvidence(nomad, job, allocations) {
  const group = job.TaskGroups[0];
  const unknown = reason => ({ state: 'unknown', reason });
  if (group.Count !== 1) return unknown('stopped');
  if (!group.Tasks[0].Services?.length) return unknown('no_control_check');
  const active = allocations.filter(a => a.DesiredStatus === 'run' && a.ClientStatus === 'running');
  if (active.length !== 1 || active[0].JobVersion !== job.Version) return unknown('no_single_current_allocation');
  let checks;
  try {
    checks = await nomad.checks(active[0].ID);
  } catch (error) {
    if (error instanceof RequestError && error.status === 502) return unknown('check_unavailable');
    throw error;
  }
  const observed = Object.values(checks ?? {}).find(c => c.Check === 'driver-communication' && c.Task === 'driver');
  if (!Number.isFinite(observed?.Timestamp)) return unknown('no_observation');
  const age = Date.now() / 1000 - observed.Timestamp;
  if (age < 0 || age >= 30) return unknown('stale_observation');
  if (!['success', 'failure'].includes(observed.Status)) return unknown('check_pending');
  return { state: observed.Status === 'success' ? 'driver-reports-connected' : 'check-failed', reason: 'fresh_observation',
    allocationId: active[0].ID, observedAt: new Date(observed.Timestamp * 1000).toISOString() };
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
    const group = job.TaskGroups[0];
    const evidence = await controlEvidence(this.nomad, job, allocations);
    return {
      ...JSON.parse(job.Meta.spec), revision: job.JobModifyIndex,
      requested: job.TaskGroups[0].Count === 1 ? 'running' : 'stopped',
      requiresOriginalStopped: job.Meta.migrated === 'true',
      image: group.Tasks[0].Config.image,
      previousVersion: JSON.parse(job.Meta.previous)?.version ?? null,
      communication: evidence.state, communicationEvidence: evidence, approval: 'unknown',
      allocations: allocations.map(a => ({
        id: a.ID, host: a.NodeName, desired: a.DesiredStatus, status: a.ClientStatus, jobVersion: a.JobVersion,
        taskState: a.TaskStates?.driver?.State, restarts: a.TaskStates?.driver?.Restarts
      }))
    };
  }

  async evaluations(nodeId) {
    const job = await this.current(nodeId);
    const evaluations = await this.nomad.evaluations(job.ID);
    return evaluations.sort((a, b) => b.CreateIndex - a.CreateIndex).slice(0, 50).map(e => ({
      id: e.ID, status: e.Status, trigger: e.TriggeredBy, revision: e.JobModifyIndex,
      placementFailures: placementIssues(e.FailedTGAllocs)
    }));
  }

  async history(nodeId) {
    const job = await this.current(nodeId);
    const result = await this.nomad.versions(job.ID);
    expect(Array.isArray(result?.Versions), 'Invalid Nomad job history', 502);
    return result.Versions.filter(entry => entry.Meta?.managed_by === 'driver-hub' && entry.ID === job.ID)
      .sort((a, b) => b.Version - a.Version).slice(0, 50).map(entry => {
        const { driverId, version } = JSON.parse(entry.Meta.spec);
        const group = entry.TaskGroups[0];
        return { driverId, version, jobVersion: entry.Version, revision: entry.JobModifyIndex,
          image: group.Tasks[0].Config.image, requested: group.Count === 1 ? 'running' : 'stopped' };
      });
  }

  async plan(job, revision) {
    const placement = await this.nomad.plan(job);
    expect(placement.currentRevision === revision, 'Deployment changed; reload its revision', 409,
      'revision_conflict', { currentRevision: placement.currentRevision });
    const group = job.TaskGroups[0];
    return {
      preview: true, requested: group.Count === 1 ? 'running' : 'stopped',
      image: group.Tasks[0].Config.image, ...placement
    };
  }

  async submit(spec, previous, running, migrated, revision, preview, stageFingerprint) {
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
    if (stageFingerprint) job.Meta.stage_request = stageFingerprint;
    if (preview) return this.plan(job, revision);
    await this.images.publish(release.record, this.store.archivePath(spec.driverId, spec.version));
    const result = await this.nomad.submit(job, revision);
    return { nodeId: spec.nodeId, image, ...result };
  }

  async stage(input, preview = false, key) {
    const migrated = input.nodeId !== undefined;
    // For a new device a client-selected random UUID can also be its stable node ID.
    // Unlike an explicitly supplied migration nodeId this never implies an original driver.
    expect(!(migrated && key !== undefined), 'For migrations use nodeId instead of Idempotency-Key');
    const nodeId = migrated ? input.nodeId : key ?? randomUUID();
    const id = jobId(nodeId);
    const spec = { nodeId, driverId: input.driverId, version: input.version, settings: input.settings ?? {} };
    const signature = key && fingerprint('stage', spec);
    const replay = job => {
      expect(!preview && signature && job.Meta?.managed_by === 'driver-hub' && job.Meta.stage_request === signature,
        'Deployment already exists', 409, 'deployment_exists');
      return { nodeId, revision: job.JobModifyIndex, replayed: true, image: job.TaskGroups[0].Tasks[0].Config.image };
    };
    const existing = await this.nomad.get(id);
    if (existing) return replay(existing);
    try {
      return await this.submit(spec, null, false, migrated, 0, preview, signature);
    } catch (error) {
      if (!signature || error.code !== 'revision_conflict' || preview) throw error;
      const winner = await this.nomad.get(id);
      if (!winner) throw error;
      return replay(winner);
    }
  }

  async change(nodeId, action, input, preview = false) {
    const job = await this.current(nodeId);
    expect(Number.isSafeInteger(input.revision) && input.revision === job.JobModifyIndex,
      'Supply the current deployment revision', 409, 'revision_conflict', { currentRevision: job.JobModifyIndex });
    let spec = JSON.parse(job.Meta.spec);
    let previous = JSON.parse(job.Meta.previous);
    let migrated = job.Meta.migrated === 'true';
    let running = job.TaskGroups[0].Count === 1;
    if (action === 'start') {
      expect(preview || !migrated || input.originalStopped === true, 'Confirm the original external driver has stopped', 409,
        'original_stop_required');
      migrated = false;
      running = true;
    } else if (action === 'stop') {
      // Stopping must work even if release files or image storage are unavailable.
      job.TaskGroups[0].Count = 0;
      if (preview) return this.plan(job, input.revision);
      return { nodeId, ...await this.nomad.submit(job, input.revision) };
    } else if (action === 'update') {
      const next = { ...spec, version: input.version, settings: input.settings ?? spec.settings };
      if (isDeepStrictEqual(next, spec) && !preview) return { nodeId, revision: job.JobModifyIndex, unchanged: true };
      previous = spec;
      spec = next;
    } else if (action === 'rollback') {
      expect(previous, 'No previous deployment configuration', 409);
      [spec, previous] = [previous, spec];
    } else {
      expect(false, 'Unknown deployment action', 404);
    }
    return this.submit(spec, previous, running, migrated, input.revision, preview, job.Meta.stage_request);
  }
}
