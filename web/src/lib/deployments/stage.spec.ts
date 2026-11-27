import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '#lib/api/client.js';
import { ApiError, NETWORK_ERROR } from '#lib/api/errors.js';
import { nodeIdProblem, stageDeployment, stageProblem } from './stage';

const key = '6f1c2a54-9d3e-4b7a-8c21-0a5e7d9b3f10';

function recordingApi(answer: unknown) {
	const requests: Request[] = [];
	const fetch = vi.fn((request: Request) => {
		requests.push(request);
		return Promise.resolve(Response.json(answer));
	});
	const api = createApiClient({
		fetch: fetch as typeof globalThis.fetch,
		baseUrl: 'http://hub.test/api/v1'
	});
	return { api, requests };
}

describe('staging', () => {
	it('sends a new device its node ID as the request key, and a replacement none', async () => {
		const { api, requests } = recordingApi({ nodeId: key, revision: 1 });
		const body = { driverId: 'meter', version: '1.0.0', settings: {} };
		await stageDeployment(api, body, key, false);
		await stageDeployment(api, { ...body, nodeId: key }, key, false);
		expect(requests[0].headers.get('Idempotency-Key')).toBe(key);
		expect(requests[1].headers.get('Idempotency-Key')).toBeNull();
		expect(new URL(requests[0].url).search).toBe('');
	});

	it('plans with dryRun and rejects an answer of the wrong kind', async () => {
		const preview = recordingApi({
			preview: true,
			requested: 'stopped',
			image: 'i',
			currentRevision: 0,
			schedulable: true,
			placementFailures: []
		});
		const body = { driverId: 'meter', version: '1.0.0' };
		await stageDeployment(preview.api, body, key, true);
		expect(new URL(preview.requests[0].url).search).toBe('?dryRun=true');
		await expect(stageDeployment(preview.api, body, key, false)).rejects.toThrow();
	});

	it('requires a lowercase, non-nil UUID to replace an external driver', () => {
		expect(nodeIdProblem(key)).toBeNull();
		expect(nodeIdProblem(key.toUpperCase())).not.toBeNull();
		expect(nodeIdProblem('00000000-0000-0000-0000-000000000000')).not.toBeNull();
		expect(nodeIdProblem(' ')).not.toBeNull();
	});

	it('explains refusals, and treats an unanswered stage as possibly done', () => {
		expect(stageProblem(new ApiError(409, 'driver_token_pool_empty', 'x'), true).kind).toBe('pool');
		expect(stageProblem(new ApiError(409, 'deployment_exists', 'x'), true).kind).toBe('exists');
		expect(
			stageProblem(
				new ApiError(422, 'invalid_settings', 'x', {
					fields: [{ field: 'host', code: 'required' }]
				}),
				false
			)
		).toMatchObject({ kind: 'settings', fields: [{ field: 'host', code: 'required' }] });
		expect(stageProblem(new ApiError(0, NETWORK_ERROR, 'x'), true).kind).toBe('uncertain');
		expect(stageProblem(new ApiError(0, NETWORK_ERROR, 'x'), false).kind).toBe('other');
		expect(stageProblem(new ApiError(503, 'unavailable', 'Configure images'), true)).toEqual({
			kind: 'other',
			message: 'Configure images'
		});
	});
});
