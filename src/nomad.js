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
          throw new RequestError(409, 'Deployment changed; reload its revision');
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
  checks(id) { return this.call(`client/allocation/${encodeURIComponent(id)}/checks`, { allowMissing: true }); }

  async submit(job, revision) {
    const plan = await this.call(`job/${job.ID}/plan`, { body: { Job: job } });
    expect(!(Object.keys(plan.FailedTGAllocs ?? {}).length), 'Nomad could not place the driver', 409);
    const result = await this.call('jobs', { body: { Job: job, EnforceIndex: true, JobModifyIndex: revision } });
    return { revision: result.JobModifyIndex, evaluationId: result.EvalID };
  }
}
