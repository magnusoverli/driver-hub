// A small, stateful stand-in for the Nomad HTTP API, covering exactly what the manager calls.
// The manager talks to it as it would to a real cluster: jobs are registered with index
// enforcement, every registration becomes a job version with an evaluation, and an allocation
// "runs" while the job asks for one instance. Tests adjust conditions Hub must report, such as a
// failing control check, through the /_fake routes.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { text } from 'node:stream/consumers';

const HOSTS = ['nomad-client-1', 'nomad-client-2', 'nomad-client-3'];

/**
 * The parts of a Nomad job the manager reads back.
 * @typedef {{
 *   ID: string,
 *   Version: number,
 *   JobModifyIndex: number,
 *   Status: string,
 *   Meta: Record<string, string>,
 *   TaskGroups: { Count: number, Tasks: { Services?: unknown[] }[] }[],
 *   [key: string]: unknown
 * }} Job
 * @typedef {{
 *   ID: string,
 *   NodeName: string,
 *   DesiredStatus: string,
 *   ClientStatus: string,
 *   JobVersion: number,
 *   CreateIndex: number,
 *   TaskStates: { driver: { State: string, Restarts: number } }
 * }} Allocation
 * @typedef {{
 *   ID: string,
 *   Status: string,
 *   TriggeredBy: string,
 *   JobModifyIndex: number,
 *   CreateIndex: number,
 *   FailedTGAllocs: Record<string, unknown> | null
 * }} Evaluation
 * @typedef {{ versions: Job[], allocations: Allocation[], evaluations: Evaluation[] }} JobRecord
 * @typedef {object} Scenario
 * @property {'pending' | 'running' | 'failed'} [allocation] Client status of the current allocation.
 * @property {'success' | 'failure' | 'none'} [check] Result of the driver-communication check.
 * @property {number} [restarts] Task restarts of the current allocation.
 * @property {boolean} [unreadable] Reading the job fails, as during a Nomad outage.
 * @property {Record<string, unknown> | null} [placement] FailedTGAllocs that plans report.
 * @property {Evaluation[]} [evaluations] Extra evaluations, newest last.
 */

export class FakeNomad {
	/** @type {Map<string, JobRecord>} */
	jobs = new Map();
	/** @type {Map<string, Scenario>} */
	scenarios = new Map();
	/** @type {Map<string, {Path: string, Items: Record<string, string>, ModifyIndex: number}>} */
	variables = new Map();
	index = 100;
	/** Set once the installation using this cluster is seeded; reported at /_fake/ready. */
	ready = false;

	reset() {
		this.jobs.clear();
		this.scenarios.clear();
		this.variables.clear();
	}

	/** @param {string} jobId @param {Scenario} scenario */
	setScenario(jobId, scenario) {
		this.scenarios.set(jobId, { ...this.scenarios.get(jobId), ...scenario });
	}

	/** @param {string} jobId */
	current(jobId) {
		return this.jobs.get(jobId)?.versions.at(-1);
	}

	/**
	 * @param {Job} job
	 * @param {boolean} enforceIndex
	 * @param {number} expectedIndex
	 * @returns {{ status: number, body: string | Record<string, unknown> }}
	 */
	register(job, enforceIndex, expectedIndex) {
		const record = this.jobs.get(job.ID) ?? { versions: [], allocations: [], evaluations: [] };
		const currentIndex = record.versions.at(-1)?.JobModifyIndex ?? 0;
		if (enforceIndex && expectedIndex !== currentIndex) {
			return {
				status: 400,
				body: `Enforcing job modify index ${expectedIndex}: job exists with conflicting job modify index: ${currentIndex}`
			};
		}
		const index = ++this.index;
		const running = job.TaskGroups[0].Count === 1;
		const version = {
			...job,
			Version: record.versions.length,
			JobModifyIndex: index,
			Status: running ? 'running' : 'dead'
		};
		record.versions.push(version);
		for (const allocation of record.allocations) {
			if (allocation.DesiredStatus === 'run') {
				allocation.DesiredStatus = 'stop';
				allocation.ClientStatus = 'complete';
				allocation.TaskStates.driver.State = 'dead';
			}
		}
		if (running) {
			record.allocations.push({
				ID: randomUUID(),
				NodeName: HOSTS[index % HOSTS.length],
				DesiredStatus: 'run',
				ClientStatus: 'running',
				JobVersion: version.Version,
				CreateIndex: index,
				TaskStates: { driver: { State: 'running', Restarts: 0 } }
			});
		}
		const evaluation = {
			ID: randomUUID(),
			Status: 'complete',
			TriggeredBy: 'job-register',
			JobModifyIndex: index,
			CreateIndex: index,
			FailedTGAllocs: null
		};
		record.evaluations.push(evaluation);
		this.jobs.set(job.ID, record);
		return { status: 200, body: { EvalID: evaluation.ID, JobModifyIndex: index, Index: index } };
	}

	/** @param {Job} job */
	plan(job) {
		const placement = this.scenarios.get(job.ID)?.placement;
		return {
			JobModifyIndex: this.current(job.ID)?.JobModifyIndex ?? 0,
			FailedTGAllocs: placement && job.TaskGroups[0].Count === 1 ? placement : null
		};
	}

	/**
	 * Allocations as Nomad reports them now, with the scenario applied to the current one.
	 * @param {string} jobId
	 * @returns {Allocation[]}
	 */
	allocations(jobId) {
		const record = this.jobs.get(jobId);
		const scenario = this.scenarios.get(jobId) ?? {};
		const latest = record?.allocations.at(-1);
		return (record?.allocations ?? []).map((allocation) => {
			if (allocation !== latest || allocation.DesiredStatus !== 'run') return allocation;
			const { State, Restarts } = allocation.TaskStates.driver;
			return {
				...allocation,
				ClientStatus: scenario.allocation ?? allocation.ClientStatus,
				TaskStates: {
					driver: {
						State: scenario.allocation === 'pending' ? 'pending' : State,
						Restarts: scenario.restarts ?? Restarts
					}
				}
			};
		});
	}

	/**
	 * The service checks of an allocation, or null when no job has it.
	 * @param {string} allocationId
	 */
	checks(allocationId) {
		for (const [jobId, record] of this.jobs) {
			const allocation = this.allocations(jobId).find((candidate) => candidate.ID === allocationId);
			const job = record.versions.at(-1);
			if (!allocation || !job) continue;
			const check = this.scenarios.get(jobId)?.check ?? 'success';
			const declared = Boolean(job.TaskGroups[0].Tasks[0].Services?.length);
			const current = record.allocations.at(-1)?.ID === allocationId;
			if (!declared || check === 'none' || allocation.ClientStatus !== 'running' || !current) {
				return {};
			}
			return {
				[`${allocationId}-check`]: {
					Check: 'driver-communication',
					Task: 'driver',
					Status: check,
					Timestamp: Math.floor(Date.now() / 1000) - 2
				}
			};
		}
		return null;
	}

	/** @param {string} jobId */
	evaluations(jobId) {
		const extra = this.scenarios.get(jobId)?.evaluations ?? [];
		return [...(this.jobs.get(jobId)?.evaluations ?? []), ...extra];
	}
}

/**
 * Reads a JSON request body. The caller states the shape it expects.
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<unknown>}
 */
async function json(request) {
	const body = await text(request);
	return body ? parseJson(body) : undefined;
}

/** @type {(text: string) => unknown} */
const parseJson = JSON.parse;

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body Strings are sent as text, as Nomad does for errors.
 */
function send(response, status, body) {
	const text = typeof body === 'string';
	response.writeHead(status, { 'Content-Type': text ? 'text/plain' : 'application/json' });
	response.end(text ? body : JSON.stringify(body));
}

/** @param {FakeNomad} nomad */
export function fakeNomadServer(nomad = new FakeNomad()) {
	return createServer((request, response) => {
		handle(nomad, request, response).catch((/** @type {unknown} */ error) =>
			send(response, 500, String(error))
		);
	});
}

/**
 * @param {FakeNomad} nomad
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function handle(nomad, request, response) {
	const url = new URL(request.url ?? '/', 'http://fake-nomad');
	const path = url.pathname;
	const method = request.method;

	// Test controls.
	if (path === '/_fake/ready') return send(response, nomad.ready ? 200 : 503, {});
	if (path === '/_fake/reset' && method === 'POST') {
		nomad.reset();
		return send(response, 200, {});
	}
	const scenario = /^\/_fake\/scenario\/([^/]+)$/.exec(path);
	if (scenario && method === 'PUT') {
		nomad.setScenario(scenario[1], /** @type {Scenario} */ (await json(request)));
		return send(response, 200, {});
	}

	// Nomad answers with a JSON-encoded string, sent here as raw text.
	if (path === '/v1/status/leader') return send(response, 200, JSON.stringify('127.0.0.1:4647'));
	if (path === '/v1/jobs' && method === 'GET') {
		const prefix = url.searchParams.get('prefix') ?? '';
		const stubs = [...nomad.jobs.values()]
			.map((record) => record.versions[record.versions.length - 1])
			.filter((job) => job.ID.startsWith(prefix))
			.sort((a, b) => a.ID.localeCompare(b.ID))
			.map(({ ID, Status, JobModifyIndex, Meta }) => ({ ID, Status, JobModifyIndex, Meta }));
		return send(response, 200, stubs);
	}
	if (path === '/v1/jobs' && method === 'POST') {
		const { Job, EnforceIndex, JobModifyIndex } =
			/** @type {{ Job: Job, EnforceIndex: boolean, JobModifyIndex: number }} */ (
				await json(request)
			);
		const result = nomad.register(Job, EnforceIndex, JobModifyIndex);
		return send(response, result.status, result.body);
	}
	const checks = /^\/v1\/client\/allocation\/([^/]+)\/checks$/.exec(path);
	if (checks) {
		const result = nomad.checks(decodeURIComponent(checks[1]));
		return result ? send(response, 200, result) : send(response, 404, 'allocation not found');
	}
	const variable = /^\/v1\/var\/(.+)$/.exec(path);
	if (variable) {
		const key = variable[1];
		if (method === 'GET') {
			const stored = nomad.variables.get(key);
			return stored ? send(response, 200, stored) : send(response, 404, 'variable not found');
		}
		const body = /** @type {{ Items: Record<string, string> }} */ (await json(request));
		const cas = Number(url.searchParams.get('cas') ?? 0);
		if ((nomad.variables.get(key)?.ModifyIndex ?? 0) !== cas) {
			return send(response, 409, 'cas conflict');
		}
		const stored = { Path: key, Items: body.Items, ModifyIndex: ++nomad.index };
		nomad.variables.set(key, stored);
		return send(response, 200, stored);
	}
	const job = /^\/v1\/job\/([^/]+)(?:\/(allocations|evaluations|versions|plan))?$/.exec(path);
	if (job) {
		const [, id, part] = job;
		if (nomad.scenarios.get(id)?.unreadable) return send(response, 500, 'rpc error: no leader');
		if (part === 'plan') {
			const { Job } = /** @type {{ Job: Job }} */ (await json(request));
			return send(response, 200, nomad.plan(Job));
		}
		const record = nomad.jobs.get(id);
		if (!record) return send(response, 404, 'job not found');
		if (part === 'allocations') return send(response, 200, nomad.allocations(id));
		if (part === 'evaluations') return send(response, 200, nomad.evaluations(id));
		if (part === 'versions')
			return send(response, 200, { Versions: [...record.versions].reverse() });
		return send(response, 200, record.versions[record.versions.length - 1]);
	}
	return send(response, 404, `fake Nomad does not implement ${method} ${path}`);
}
