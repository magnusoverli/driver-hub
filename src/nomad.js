import { RequestError, expect } from './errors.js';

export class Nomad {
  constructor(address, token, namespace = 'default', request = fetch) {
    this.address = address;
    this.token = token;
    this.namespace = namespace;
    this.request = request;
  }

  async call(path, { body, allowMissing = false } = {}) {
    expect(this.address, 'Nomad integration is not configured', 503);
    const url = new URL(`/v1/${path}`, this.address);
    url.searchParams.set('namespace', this.namespace);
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['X-Nomad-Token'] = this.token;
    try {
      const response = await this.request(url, {
        headers, method: body ? 'POST' : 'GET', body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(20000), redirect: 'error'
      });
      if (allowMissing && response.status === 404) return null;
      if (!response.ok) {
        const reason = (await response.text()).slice(0, 1024);
        if (/Enforcing job modify index/i.test(reason) || response.status === 409) {
          throw new RequestError(409, 'Deployment changed; reload its revision', 'revision_conflict');
        }
        throw new RequestError(502, `Nomad rejected the request (HTTP ${response.status})`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(502, 'Nomad request failed; read deployment state before retrying');
    }
  }

  get(id) { return this.call(`job/${id}`, { allowMissing: true }); }
  list() { return this.call('jobs?prefix=driverhub-&meta=true'); }
  allocations(id) { return this.call(`job/${id}/allocations`); }
  evaluations(id) { return this.call(`job/${id}/evaluations`); }
  versions(id) { return this.call(`job/${id}/versions?diffs=false`); }
  checks(id) { return this.call(`client/allocation/${encodeURIComponent(id)}/checks`, { allowMissing: true }); }

  async connection() {
    if (!this.address) return { state: 'not_configured', namespace: this.namespace };
    const leader = await this.call('status/leader');
    if (typeof leader !== 'string') throw new RequestError(502, 'Invalid Nomad leader response');
    if (!leader) return { state: 'no_leader', namespace: this.namespace };
    expect(Array.isArray(await this.list()), 'Invalid Nomad job list', 502);
    return { state: 'connected', namespace: this.namespace };
  }

  async plan(job) {
    const plan = await this.call(`job/${job.ID}/plan`, { body: { Job: job } });
    expect(Number.isSafeInteger(plan?.JobModifyIndex), 'Nomad returned an invalid plan', 502);
    const placementFailures = placementIssues(plan.FailedTGAllocs);
    return { currentRevision: plan.JobModifyIndex, placementFailures, schedulable: placementFailures.length === 0 };
  }

  async submit(job, revision) {
    const plan = await this.plan(job);
    expect(plan.schedulable, 'Nomad could not place the driver', 409, 'placement_failed', plan);
    const result = await this.call('jobs', { body: { Job: job, EnforceIndex: true, JobModifyIndex: revision } });
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
