import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { expect, RequestError } from './errors.js';
import { createJob } from './job.js';
import { imageKey } from './images.js';
import { parseTag } from './release.js';
import { placementIssues, requireSecureNomad } from './nomad.js';
import { fingerprint, uuidPattern } from './request-key.js';
import { selectProfile, validateNodeId } from './deployment-inputs.js';
import { normalizeLabel } from './labels.js';

const managed = job => job?.Meta?.managed_by === 'driver-hub';
const running = job => !job.Stop && job.TaskGroups[0].Count === 1;
const terminal = a => ['complete', 'failed'].includes(a.ClientStatus);
const releaseRef = spec => `${spec.driverId}/${spec.version}`;

function metadata(job) {
  const invalid = () => new RequestError(409, 'Managed Nomad job has unexpected metadata or task layout', 'job_drift');
  let spec, previous;
  try { spec = JSON.parse(job.Meta.spec); previous = JSON.parse(job.Meta.previous ?? 'null'); }
  catch { throw invalid(); }
  if (!spec || typeof spec.driverId !== 'string' || typeof spec.version !== 'string' ||
    !uuidPattern.test(spec.nodeId) || `driverhub-${spec.nodeId}` !== job.ID ||
    !parseTag(`drivers/${spec.driverId}/v${spec.version}`) ||
    (spec.videoIPath && (typeof spec.videoIPath.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(spec.videoIPath.id))) ||
    (previous !== null && (previous.nodeId !== spec.nodeId || previous.driverId !== spec.driverId ||
      !parseTag(`drivers/${previous.driverId}/v${previous.version}`))) ||
    (job.Meta.hub_schema !== undefined && job.Meta.hub_schema !== '1')) throw invalid();
  return { spec, previous };
}

async function mapLimited(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const index = next++; results[index] = await run(items[index]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function allocationView(a) {
  const event = a.TaskStates?.driver?.Events?.at(-1);
  return { id: a.ID, host: a.NodeName, desired: a.DesiredStatus, status: a.ClientStatus, jobVersion: a.JobVersion,
    ...(event && /^[A-Za-z][A-Za-z -]{0,47}$/.test(event.Type) && { lastEvent: event.Type }),
    taskState: a.TaskStates?.driver?.State, restarts: a.TaskStates?.driver?.Restarts };
}

// The allocation an operator means by "where it runs": the newest one Nomad still wants running.
function currentAllocation(allocations) {
  const wanted = allocations.filter(a => a.DesiredStatus === 'run')
    .sort((a, b) => (b.JobVersion ?? 0) - (a.JobVersion ?? 0) || (b.CreateIndex ?? 0) - (a.CreateIndex ?? 0));
  return wanted.length ? allocationView(wanted[0]) : null;
}

function jobId(nodeId) {
  validateNodeId(nodeId);
  return `driverhub-${nodeId}`;
}

async function controlEvidence(nomad, job, allocations) {
  const group = job.TaskGroups[0];
  const unknown = reason => ({ state: 'unknown', reason });
  if (!running(job)) return unknown('stopped');
  if (!group.Tasks[0].Services?.length) return unknown('no_control_check');
  const active = allocations.filter(a => a.DesiredStatus === 'run' && a.ClientStatus === 'running');
  if (active.length !== 1 || active[0].JobVersion !== job.Version ||
    allocations.some(a => a !== active[0] && !terminal(a))) return unknown('no_single_current_allocation');
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
  static forSite(site, services) {
    const { nomad, videoipath } = site.state;
    // Only this non-secret snapshot is safe to carry in Nomad job metadata.
    const profile = videoipath && { id: videoipath.id, url: videoipath.url, mode: videoipath.mode };
    return new Deployments({ ...services, site, profile, nomad: site.client(nomad), datacenters: nomad.datacenters });
  }

  constructor({ nomad, store, images, registry, datacenters, site, profile, labels, nomadUi, sharedWriters }) {
    Object.assign(this, { nomad, store, images, registry, datacenters, site, profile, labels, nomadUi, sharedWriters });
  }

  label(nodeId) { return this.labels?.get(nodeId) ?? null; }

  identity(nodeId) {
    return { nodeId, target: fingerprint('nomad', [this.nomad.address, this.nomad.namespace]) };
  }

  validate(job) {
    expect(managed(job) && (!job.Meta.hub_owner || job.Meta.hub_owner === this.site?.journal?.owner),
      'Job belongs to another manager', 409, 'job_drift');
    const group = job.TaskGroups?.[0], task = group?.Tasks?.[0];
    expect(job.TaskGroups?.length === 1 && group?.Name === 'device' && [0, 1].includes(group.Count) &&
      group.Tasks?.length === 1 && task?.Name === 'driver' && task.Driver === 'docker' &&
      typeof task.Config?.image === 'string' && (!job.Namespace || job.Namespace === this.nomad.namespace),
    'Managed Nomad job has unexpected task layout', 409, 'job_drift');
    return metadata(job);
  }

  // Requested state and verifiable evidence, shared by the list overview and the detail view.
  async observe(job, allocations) {
    const evidence = await controlEvidence(this.nomad, job, allocations);
    return {
      requested: running(job) ? 'running' : 'stopped',
      requiresOriginalStopped: job.Meta.migrated === 'true',
      communication: evidence.state, communicationEvidence: evidence, approval: 'unknown'
    };
  }

  // One row per managed device with what a list needs for triage. A device whose state Nomad
  // cannot report right now stays listed with unknown evidence instead of failing the whole list.
  async overview() {
    const jobs = (await this.nomad.list()).filter(managed);
    return mapLimited(jobs, 8, async stub => {
      const nodeId = typeof stub.ID === 'string' && stub.ID.startsWith('driverhub-') && stub.ID.slice('driverhub-'.length);
      if (!uuidPattern.test(nodeId)) return null;
      const row = { nodeId, driverId: 'unknown', version: 'unknown', label: this.label(nodeId), status: stub.Status, revision: stub.JobModifyIndex };
      const unavailable = reason => ({ ...row, requested: null, requiresOriginalStopped: stub.Meta.migrated === 'true',
        communication: 'unknown', communicationEvidence: { state: 'unknown', reason }, approval: 'unknown', allocation: null });
      try {
        const { spec } = metadata(stub);
        Object.assign(row, { driverId: spec.driverId, version: spec.version });
        const job = await this.nomad.get(stub.ID);
        if (!job || !managed(job) || job.ID !== stub.ID) return unavailable('job_unavailable');
        const { spec: current } = this.validate(job);
        const allocations = await this.nomad.allocations(job.ID);
        return { ...row, driverId: current.driverId, version: current.version, status: job.Status, revision: job.JobModifyIndex, ...await this.observe(job, allocations),
          allocation: currentAllocation(allocations) };
      } catch (error) {
        if (error.code === 'job_drift') return unavailable('job_drift');
        if (error instanceof RequestError && error.status === 502) return unavailable('status_unavailable');
        throw error;
      }
    }).then(rows => rows.filter(Boolean).map(row => {
      const at = row.communicationEvidence.observedAt;
      if (at && Date.now() - Date.parse(at) >= 30000)
        return { ...row, communication: 'unknown', communicationEvidence: { state: 'unknown', reason: 'stale_observation' } };
      return row;
    }));
  }

  async relabel(nodeId, label) {
    expect(this.labels, 'Deployment labels are not configured', 503);
    expect(label !== undefined, 'Supply a label, or null to clear it', 400, 'invalid_label');
    normalizeLabel(label);
    await this.current(nodeId);
    return { nodeId, label: await this.labels.set(nodeId, label) ?? null };
  }

  async list() {
    const jobs = await this.nomad.list();
    return jobs.filter(managed).flatMap(job => {
      try {
        const { nodeId, driverId, version } = metadata(job).spec;
        return [{ nodeId, driverId, version, status: job.Status, revision: job.JobModifyIndex }];
      } catch (error) { if (error.code === 'job_drift') return []; throw error; }
    });
  }

  async current(nodeId) {
    const job = await this.nomad.get(jobId(nodeId));
    expect(job, 'Unknown deployment', 404);
    expect(job.ID === jobId(nodeId), 'Unexpected Nomad job identity', 502);
    this.validate(job);
    return job;
  }

  async status(nodeId) {
    const job = await this.current(nodeId);
    const allocations = await this.nomad.allocations(job.ID);
    const spec = JSON.parse(job.Meta.spec);
    return {
      ...spec, label: this.label(nodeId), revision: job.JobModifyIndex,
      // Updates keep the target saved at staging; clients need this to render the settings form.
      inheritsSite: Boolean(spec.videoIPath),
      image: job.TaskGroups[0].Tasks[0].Config.image,
      previousVersion: JSON.parse(job.Meta.previous ?? 'null')?.version ?? null,
      ...await this.observe(job, allocations),
      allocations: allocations.sort((a, b) => (b.CreateIndex ?? 0) - (a.CreateIndex ?? 0)).map(a => ({
        ...allocationView(a), ...(this.nomadUi && uuidPattern.test(a.ID) && {
          logsUrl: `${this.nomadUi}/ui/allocations/${a.ID}/driver/logs?namespace=${encodeURIComponent(this.nomad.namespace)}`
        })
      }))
    };
  }

  // Before switching targets, also pin legacy jobs first seen before the journal existed.
  // A successful authoritative scan can retire confirmed pins for jobs removed externally.
  async checkpointTarget() {
    const journal = this.site.journal;
    const live = new Set();
    for (const job of (await this.nomad.list()).filter(managed)) {
      const { spec, previous } = metadata(job), identity = this.identity(spec.nodeId);
      live.add(spec.nodeId);
      const prior = journal.get(identity);
      if (!prior?.pending && !prior?.deleting)
        await journal.save({ ...identity, refs: [spec, previous].filter(Boolean).map(releaseRef) });
    }
    for (const record of journal.records.values()) {
      if (record.target === this.identity(record.nodeId).target && !live.has(record.nodeId) && !record.pending && !record.deleting)
        await journal.forget(record);
    }
  }

  // Deletes a stopped deployment: the Nomad job with its history, Hub's label and the registration
  // Variable Hub wrote. The device's own secrets Variable and its reserved token are left alone:
  // Hub did not create the first, and the second is removed from the site's pool explicitly.
  async remove(nodeId, revision) {
    expect(!this.sharedWriters, 'Purge requires exclusive management of this Nomad namespace', 409, 'shared_writers');
    const identity = this.identity(nodeId), journal = this.site?.journal;
    let record = journal?.get(identity);
    const id = jobId(nodeId);
    const job = await this.nomad.get(id);
    if (job) {
      const { spec, previous } = this.validate(job);
      expect(job.ID === id && Number.isSafeInteger(revision) && revision === job.JobModifyIndex,
        'Supply the current deployment revision', 409, 'revision_conflict', { currentRevision: job.JobModifyIndex });
      expect(!running(job), 'Stop the deployment before deleting it', 409, 'deployment_running');
      expect((await this.nomad.allocations(id)).every(terminal),
        'Nomad has not confirmed termination of all allocations; check the client before deletion', 409, 'allocation_not_stopped');
      record = { ...identity, refs: [spec, previous].filter(Boolean).map(releaseRef), deleting: revision,
        profile: spec.videoIPath?.id, index: job.Meta.registration_index };
      await journal?.save(record);
      await this.nomad.deregister(id);
    } else {
      expect(record && record.deleting === revision, 'Unknown deployment', 404);
    }
    let registrationVariable = 'none';
    if (record.profile) {
      try {
        registrationVariable = await this.nomad.removeRegistrationToken({ ID: id, Meta: { registration_index: record.index } },
          `vip_${record.profile}`);
      } catch (error) {
        if (!(error instanceof RequestError)) throw error;
        registrationVariable = 'failed';
      }
    }
    if (this.labels) await this.labels.set(nodeId, null);
    if (registrationVariable !== 'failed') await journal?.forget(identity);
    return { nodeId, deleted: true, registrationVariable };
  }

  // Deployments that run a release now or keep it to roll back to.
  async usage(driverId, version) {
    const jobs = (await this.nomad.list()).filter(managed);
    const uses = jobs.flatMap(job => {
      const { spec, previous } = metadata(job);
      const uses = [];
      if (spec.driverId === driverId && spec.version === version) uses.push({ nodeId: spec.nodeId, use: 'current' });
      if (previous?.driverId === driverId && previous.version === version) uses.push({ nodeId: spec.nodeId, use: 'previous' });
      return uses;
    });
    for (const record of this.site?.journal.records.values() ?? []) {
      if ((record.target !== this.identity(record.nodeId).target || record.pending || record.deleting) &&
        record.refs.includes(`${driverId}/${version}`)) uses.push({ nodeId: record.nodeId, use: 'unconfirmed' });
    }
    return uses;
  }

  async evaluations(nodeId) {
    const job = await this.current(nodeId);
    const evaluations = await this.nomad.evaluations(job.ID);
    return evaluations.sort((a, b) => b.CreateIndex - a.CreateIndex).slice(0, 50).map(e => ({
      id: e.ID, status: e.Status, trigger: e.TriggeredBy, revision: e.JobModifyIndex,
      placementFailures: placementIssues(e.FailedTGAllocs)
    }));
  }

  async rollout(nodeId) {
    const job = await this.current(nodeId);
    const rollout = await this.nomad.call(`job/${job.ID}/deployment`, { allowMissing: true });
    if (!rollout || rollout.JobID !== job.ID || rollout.JobVersion !== job.Version ||
      rollout.Namespace !== this.nomad.namespace) return null;
    expect(typeof rollout.Status === 'string' && typeof rollout.ID === 'string', 'Invalid Nomad rollout', 502);
    return { id: rollout.ID, jobVersion: rollout.JobVersion, status: rollout.Status };
  }

  async history(nodeId) {
    const job = await this.current(nodeId);
    const result = await this.nomad.versions(job.ID);
    expect(Array.isArray(result?.Versions), 'Invalid Nomad job history', 502);
    return result.Versions.filter(entry => managed(entry) && entry.ID === job.ID)
      .sort((a, b) => b.Version - a.Version).slice(0, 50).map(entry => {
        const { driverId, version } = this.validate(entry).spec;
        const group = entry.TaskGroups[0];
        return { driverId, version, jobVersion: entry.Version, revision: entry.JobModifyIndex,
          image: group.Tasks[0].Config.image, requested: running(entry) ? 'running' : 'stopped' };
      });
  }

  async plan(job, revision) {
    const placement = await this.nomad.plan(job);
    expect(placement.currentRevision === revision, 'Deployment changed; reload its revision', 409,
      'revision_conflict', { currentRevision: placement.currentRevision });
    const group = job.TaskGroups[0];
    return {
      preview: true, requested: running(job) ? 'running' : 'stopped',
      image: group.Tasks[0].Config.image, ...placement
    };
  }

  async submit(spec, previous, running, migrated, revision, preview, stageFingerprint, registrationIndex) {
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
    const journal = this.site?.journal, identity = this.identity(spec.nodeId);
    if (journal) job.Meta.hub_owner = journal.owner;
    if (registrationIndex) job.Meta.registration_index = registrationIndex;
    if (preview) return this.plan(job, revision);
    await this.images.publish(release.record, this.store.archivePath(spec.driverId, spec.version));
    const prior = journal?.get(identity);
    const refs = [spec, previous].filter(Boolean).map(releaseRef);
    const provision = async () => {
      const pending = { ...identity, pending: true, ...(revision === 0 && { stageRequest: stageFingerprint }),
        refs: [...new Set([...refs, ...(prior?.refs ?? [])])] };
      await journal?.save(pending);
      if (revision === 0 && spec.videoIPath) {
        const token = await this.site.claim(spec.videoIPath.id, spec.nodeId);
        const saved = await this.nomad.ensureRegistrationToken(job.ID, `vip_${spec.videoIPath.id}`, token);
        const index = saved ?? ((prior?.profile === spec.videoIPath.id && prior.index) || 'borrowed');
        job.Meta.registration_index = index;
        await journal?.save({ ...pending, profile: spec.videoIPath.id, index });
      }
    };
    const result = await this.nomad.submit(job, revision, provision);
    await journal?.save({ ...identity, refs });
    return { nodeId: spec.nodeId, image, ...result };
  }

  async stage(input, preview = false, key) {
    const label = normalizeLabel(input.label);
    expect(label === undefined || this.labels, 'Deployment labels are not configured', 503);
    const result = await this.register(input, preview, key);
    // The label is not part of the job, so a replayed stage may still name the device.
    if (!preview && label !== undefined) await this.labels.set(result.nodeId, label);
    return result;
  }

  async register(input, preview, key) {
    const migrated = input.nodeId !== undefined;
    // For a new device a client-selected random UUID can also be its stable node ID.
    // Unlike an explicitly supplied migration nodeId this never implies an original driver.
    expect(!(migrated && key !== undefined), 'For migrations use nodeId instead of Idempotency-Key');
    const nodeId = migrated ? input.nodeId : key ?? randomUUID();
    const id = jobId(nodeId);
    const spec = { nodeId, driverId: input.driverId, version: input.version, settings: input.settings ?? {} };
    const signature = key && fingerprint('stage', input.inheritSite === undefined ? spec : { ...spec, inheritSite: input.inheritSite });
    const replay = job => {
      expect(!preview && signature && managed(job) && job.Meta.stage_request === signature,
        'Deployment already exists', 409, 'deployment_exists');
      return { nodeId, revision: job.JobModifyIndex, replayed: true, image: job.TaskGroups[0].Tasks[0].Config.image };
    };
    const existing = await this.nomad.get(id);
    if (existing) {
      this.validate(existing);
      const result = replay(existing);
      const journal = this.site?.journal, identity = this.identity(nodeId);
      if (signature && journal?.get(identity)?.stageRequest === signature) {
        const { spec: live, previous } = metadata(existing);
        await journal.save({ ...identity, refs: [live, previous].filter(Boolean).map(releaseRef) });
      }
      return result;
    }
    expect(!this.site?.journal.get(this.identity(nodeId))?.deleting,
      'Finish the previous deployment deletion before reusing this device ID', 409, 'cleanup_pending');
    const profile = selectProfile(input.inheritSite, this.profile);
    if (profile) {
      expect(preview || key || migrated, 'Supply Idempotency-Key when staging a new site-managed device');
      requireSecureNomad(this.nomad.address);
      this.site.checkAvailable(profile.id, nodeId);
      spec.videoIPath = profile;
    }
    try {
      return await this.submit(spec, null, false, migrated, 0, preview, signature);
    } catch (error) {
      if (!signature || error.code !== 'revision_conflict' || preview) throw error;
      const winner = await this.nomad.get(id);
      if (!winner) throw error;
      this.validate(winner);
      return replay(winner);
    }
  }

  async change(nodeId, action, input, preview = false) {
    const job = await this.current(nodeId);
    expect(Number.isSafeInteger(input.revision) && input.revision === job.JobModifyIndex,
      'Supply the current deployment revision', 409, 'revision_conflict', { currentRevision: job.JobModifyIndex });
    let spec = JSON.parse(job.Meta.spec);
    let previous = JSON.parse(job.Meta.previous ?? 'null');
    let migrated = job.Meta.migrated === 'true';
    let start = running(job);
    if (action === 'start') {
      expect(preview || !migrated || input.originalStopped === true, 'Confirm the original external driver has stopped', 409,
        'original_stop_required');
      migrated = false;
      start = true;
    } else if (action === 'stop') {
      // Stopping must work even if release files or image storage are unavailable.
      job.TaskGroups[0].Count = 0;
      job.Stop = false;
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
    return this.submit(spec, previous, start, migrated, input.revision, preview, job.Meta.stage_request, job.Meta.registration_index);
  }
}
