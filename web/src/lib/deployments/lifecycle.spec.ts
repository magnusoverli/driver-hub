import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '#lib/api/client.js';
import { ApiError, NETWORK_ERROR } from '#lib/api/errors.js';
import { actionProblem, applyAction, previewAction } from './lifecycle';

const nodeId = '11111111-1111-4111-8111-111111111111';
const preview = {
	preview: true,
	requested: 'running',
	image: 'images/driverhub/k@sha256:abc',
	currentRevision: 7,
	schedulable: true,
	placementFailures: []
};

function recordingApi(body: unknown) {
	const requests: Request[] = [];
	const fetch = vi.fn((input: Request) => {
		requests.push(input);
		return Promise.resolve(Response.json(body));
	});
	const api = createApiClient({
		fetch: fetch as typeof globalThis.fetch,
		baseUrl: 'http://hub.test/api/v1'
	});
	return { api, requests };
}

describe('lifecycle requests', () => {
	it('previews with dryRun and the reviewed revision, marked as a browser write', async () => {
		const { api, requests } = recordingApi(preview);
		await expect(previewAction(api, 'start', { nodeId, revision: 7 })).resolves.toEqual(preview);
		const [request] = requests;
		expect(request.method).toBe('POST');
		expect(new URL(request.url).pathname).toBe(`/api/v1/deployments/${nodeId}/start`);
		expect(new URL(request.url).search).toBe('?dryRun=true');
		expect(request.headers.get('X-Driver-Hub-Request')).toBe('1');
		expect(await request.json()).toEqual({ revision: 7 });
	});

	it('applies without dryRun, confirming a stopped original only when asked to', async () => {
		const { api, requests } = recordingApi({ nodeId, revision: 8 });
		await applyAction(api, 'start', { nodeId, revision: 7, originalStopped: true });
		await applyAction(api, 'update', { nodeId, revision: 8, version: '1.4.0' });
		await applyAction(api, 'stop', { nodeId, revision: 9, originalStopped: false });
		expect(requests.map((r) => new URL(r.url).search)).toEqual(['', '', '']);
		expect(await requests[0].json()).toEqual({ revision: 7, originalStopped: true });
		expect(await requests[1].json()).toEqual({ revision: 8, version: '1.4.0' });
		expect(await requests[2].json()).toEqual({ revision: 9 });
	});

	it('refuses to treat a preview as an applied change, or the reverse', async () => {
		await expect(
			applyAction(recordingApi(preview).api, 'stop', { nodeId, revision: 7 })
		).rejects.toThrow();
		await expect(
			previewAction(recordingApi({ nodeId, revision: 8 }).api, 'stop', { nodeId, revision: 7 })
		).rejects.toThrow();
	});
});

describe('action problems', () => {
	it('asks to review the current state after a concurrent change', () => {
		const conflict = new ApiError(409, 'revision_conflict', 'Deployment changed');
		expect(actionProblem(conflict, 'preview').kind).toBe('conflict');
		expect(actionProblem(conflict, 'apply').kind).toBe('conflict');
	});

	it('treats a submission without a definite answer as possibly applied', () => {
		for (const error of [
			new ApiError(0, NETWORK_ERROR, 'unreachable'),
			new ApiError(502, 'upstream_error', 'Nomad request failed'),
			new ApiError(500, 'internal_error', 'Internal server error')
		]) {
			expect(actionProblem(error, 'apply').kind).toBe('uncertain');
			expect(actionProblem(error, 'preview').kind).toBe('other');
		}
		// A 503 is refused before anything is attempted, and says why.
		const missingSetup = new ApiError(503, 'unavailable', 'Configure the image distribution');
		expect(actionProblem(missingSetup, 'apply')).toEqual({
			kind: 'other',
			message: 'Configure the image distribution'
		});
	});

	it('lists the settings a target version needs', () => {
		const error = new ApiError(422, 'invalid_settings', 'Invalid deployment settings', {
			fields: [{ field: 'region', code: 'required' }, { nonsense: true }]
		});
		expect(actionProblem(error, 'preview')).toMatchObject({
			kind: 'settings',
			fields: [{ field: 'region', code: 'required' }]
		});
	});

	it('reports placement failures and the migration confirmation', () => {
		const failures = [
			{
				group: 'device',
				nodesEvaluated: 2,
				nodesFiltered: 2,
				nodesExhausted: 0,
				constraints: {},
				resources: {}
			}
		];
		const placement = new ApiError(409, 'placement_failed', 'No placement', {
			placementFailures: failures
		});
		expect(actionProblem(placement, 'apply')).toMatchObject({ kind: 'placement', failures });
		expect(
			actionProblem(new ApiError(409, 'original_stop_required', 'Confirm'), 'apply').kind
		).toBe('original');
	});

	it('explains a version that is not downloaded yet', () => {
		const error = new ApiError(404, 'not_found', 'Release must be retained before deployment');
		expect(actionProblem(error, 'preview').message).toMatch(/catalog/);
	});
});
