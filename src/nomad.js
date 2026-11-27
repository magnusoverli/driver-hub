import { RequestError, expect } from './errors.js';
import { AsyncLocalStorage } from 'node:async_hooks';

// Optional request-level counters; never record paths, tokens or request/response bodies.
export const nomadTiming = new AsyncLocalStorage();

// Credentials go to a remote Nomad over HTTPS only, unless an administrator allowed plain HTTP
// for a trusted network in the Nomad settings.
export function requireSecureNomad(address, plainHttp = false) {
  let url;
  try { url = new URL(address); } catch { /* rejected below */ }
  expect(url && !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' &&
    (plainHttp || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))),
  'Use HTTPS to send credentials to a remote Nomad endpoint, or allow plain HTTP for a trusted network', 422,
  'nomad_plain_http');
}

export class Nomad {
  constructor(address, token, namespace = 'default', request = fetch, { plainHttp = false } = {}) {
    this.address = address;
    this.token = token;
    this.namespace = namespace;
    this.request = request;
    this.plainHttp = plainHttp;
    if (token) requireSecureNomad(address, plainHttp);
  }

  async call(path, { body, allowMissing = false, valid, method = body ? 'POST' : 'GET' } = {}) {
    expect(this.address, 'Nomad integration is not configured', 503);
    const url = new URL(`/v1/${path}`, this.address);
    url.searchParams.set('namespace', this.namespace);
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['X-Nomad-Token'] = this.token;
    const metrics = nomadTiming.getStore();
    if (metrics) metrics.calls++;
    try {
      const response = await this.request(url, {
        headers, method, body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(20000), redirect: 'error'
      });
      if (allowMissing && response.status === 404) return null;
      if (!response.ok) {
        const text = await response.text();
        if (metrics) metrics.bytes += Buffer.byteLength(text);
        const reason = text.slice(0, 1024);
        if (path.startsWith('var/') && response.status === 409)
          throw new RequestError(409, 'Nomad Variable changed; inspect its current state', 'variable_conflict');
        if (path === 'jobs' && (/Enforcing job modify index/i.test(reason) || response.status === 409)) {
          throw new RequestError(409, 'Deployment changed; reload its revision', 'revision_conflict');
        }
        const code = [401, 403].includes(response.status) ? 'nomad_access_denied' :
          response.status === 429 ? 'nomad_busy' : response.status < 500 ? 'nomad_rejected' : 'nomad_unavailable';
        throw new RequestError(502, `Nomad rejected the request (HTTP ${response.status})`, code);
      }
      // Deletions may answer without a body.
      const text = await response.text();
      if (metrics) metrics.bytes += Buffer.byteLength(text);
      const result = text ? JSON.parse(text) : null;
      if (valid) expect(valid(result), 'Invalid Nomad response; inspect state before retrying', 502,
        method === 'GET' ? 'nomad_invalid_response' : 'nomad_write_unconfirmed');
      return result;
    } catch (error) {
      if (metrics) metrics.errors++;
      if (error instanceof RequestError) throw error;
      throw new RequestError(502, 'Nomad request failed; read deployment state before retrying',
        method === 'GET' || path.endsWith('/plan') ? 'nomad_unavailable' : 'nomad_write_unconfirmed');
    }
  }

  get(id) { return this.call(`job/${id}`, { allowMissing: true, valid: job => job?.ID === id }); }
  async collection(path) {
    const result = await this.call(path);
    expect(Array.isArray(result), 'Invalid Nomad collection response', 502);
    return result;
  }
  list() { return this.collection('jobs?prefix=driverhub-&meta=true'); }
  allocations(id) { return this.collection(`job/${id}/allocations`); }
  evaluations(id) { return this.collection(`job/${id}/evaluations`); }
  versions(id) { return this.call(`job/${id}/versions?diffs=false`); }
  checks(id) { return this.call(`client/allocation/${encodeURIComponent(id)}/checks`, { allowMissing: true }); }
  // Purging removes the job and its version history, so a deleted deployment is not listed again.
  // Nomad's deregistration has no modify-index check; callers compare revisions just before.
  deregister(id) { return this.call(`job/${id}?purge=true`, { method: 'DELETE',
    valid: result => typeof result?.EvalID === 'string' && result.EvalID.length > 0 }); }
  // For Hub's own image job, which only Hub writes: no modify-index check.
  register(job) { return this.call('jobs', { body: { Job: job },
    valid: result => typeof result?.EvalID === 'string' || Number.isSafeInteger(result?.JobModifyIndex) }); }
  putVariable(path, items) { return this.call(`var/${path}`, { method: 'PUT', body: { Path: path, Items: items },
    valid: saved => saved?.Path === path }); }
  async services(name) {
    const result = await this.call(`service/${encodeURIComponent(name)}`, { allowMissing: true });
    return Array.isArray(result) ? result : [];
  }
  variable(path) { return this.call(`var/${path}`, { allowMissing: true, valid: variable =>
    variable?.Path === path && Number.isSafeInteger(variable.ModifyIndex) && variable.ModifyIndex > 0 &&
    variable.Items && typeof variable.Items === 'object' && !Array.isArray(variable.Items) }); }

  async connection() {
    if (!this.address) return { state: 'not_configured', namespace: this.namespace };
    const leader = await this.call('status/leader');
    if (typeof leader !== 'string') throw new RequestError(502, 'Invalid Nomad leader response');
    if (!leader) return { state: 'no_leader', namespace: this.namespace };
    await this.collection('jobs?prefix=driverhub-&per_page=1');
    return { state: 'connected', namespace: this.namespace };
  }

  async plan(job) {
    const plan = await this.call(`job/${job.ID}/plan`, { body: { Job: job } });
    expect(Number.isSafeInteger(plan?.JobModifyIndex), 'Nomad returned an invalid plan', 502);
    const placementFailures = placementIssues(plan.FailedTGAllocs);
    return { currentRevision: plan.JobModifyIndex, placementFailures, schedulable: placementFailures.length === 0 };
  }

  async ensureRegistrationToken(jobId, key, token) {
    const path = `nomad/jobs/${jobId}/device/driver`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const variable = await this.variable(path);
      if (Object.hasOwn(variable?.Items ?? {}, key)) {
        expect(variable.Items[key] === token, 'Registration variable key already has different content', 409);
        return null; // Identical content is usable, but not proof of ownership.
      }
      try {
        const saved = await this.call(`var/${path}?cas=${variable?.ModifyIndex ?? 0}`, {
          method: 'PUT', body: { Path: path, Items: { ...variable?.Items, [key]: token } }
        });
        expect(saved?.Path === path && Number.isSafeInteger(saved.ModifyIndex) && saved.ModifyIndex > 0,
          'Unconfirmed Nomad Variable write; inspect state before retrying', 502, 'nomad_write_unconfirmed');
        return String(saved.ModifyIndex);
      } catch (error) {
        if (error.status !== 409 || attempt === 2) throw error;
      }
    }
  }

  async removeRegistrationToken(job, key) {
    if (job.Meta.registration_index === 'borrowed') return 'none';
    const path = `nomad/jobs/${job.ID}/device/driver`;
    const current = await this.variable(path);
    if (!current || !Object.hasOwn(current.Items ?? {}, key)) return 'none';
    // Legacy jobs, pre-existing keys and changed/recreated Variables are left for the operator.
    const index = current.ModifyIndex;
    if (!Number.isSafeInteger(index) || index <= 0 || job.Meta.registration_index !== String(index)) return 'failed';
    const items = { ...current.Items };
    delete items[key];
    await this.call(`var/${path}?cas=${index}`, Object.keys(items).length
      ? { method: 'PUT', body: { Path: path, Items: items } } : { method: 'DELETE' });
    return 'removed';
  }

  async submit(job, revision, beforeRegister) {
    const plan = await this.plan(job);
    expect(plan.currentRevision === revision, 'Deployment changed; reload its revision', 409, 'revision_conflict');
    expect(plan.schedulable, 'Nomad could not place the driver', 409, 'placement_failed', plan);
    if (beforeRegister) await beforeRegister();
    const result = await this.call('jobs', { body: { Job: job, EnforceIndex: true, JobModifyIndex: revision } });
    expect(Number.isSafeInteger(result?.JobModifyIndex) && result.JobModifyIndex > 0 &&
      typeof result.EvalID === 'string' && result.EvalID.length > 0,
    'Unconfirmed Nomad registration; inspect deployment state before retrying', 502, 'nomad_write_unconfirmed');
    return { revision: result.JobModifyIndex, evaluationId: result.EvalID };
  }
}

export function placementIssues(failures) {
  return Object.entries(failures ?? {}).map(([group, failure]) => ({
    group, nodesEvaluated: failure.NodesEvaluated ?? 0, nodesFiltered: failure.NodesFiltered ?? 0,
    nodesExhausted: failure.NodesExhausted ?? 0,
    constraints: failure.ConstraintFiltered ?? {}, resources: failure.DimensionExhausted ?? {}
  }));
}
