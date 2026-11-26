import { describe, expect, it, vi } from 'vitest';
import { createApiClient, unwrap } from './client.js';
import { ApiError, NETWORK_ERROR } from './errors.js';

type Captured = { method: string; path: string; headers: Headers };

function fakeBackend(status = 200, body: unknown = {}) {
	const requests: Captured[] = [];
	const fetch = vi.fn((input: Request) => {
		requests.push({
			method: input.method,
			path: new URL(input.url).pathname,
			headers: input.headers
		});
		return Promise.resolve(Response.json(body, { status }));
	});
	return { requests, fetch: fetch as unknown as typeof globalThis.fetch };
}

const baseUrl = 'http://hub.test/api/v1';

describe('API client', () => {
	it('marks every write as a browser request and leaves reads alone', async () => {
		const backend = fakeBackend();
		const api = createApiClient({ fetch: backend.fetch, baseUrl });
		await api.GET('/capabilities');
		await api.PUT('/deployments/{nodeId}/label', {
			params: { path: { nodeId: '11111111-1111-4111-8111-111111111111' } },
			body: { label: 'Studio 3' }
		});
		expect(backend.requests.map((r) => [r.method, r.headers.get('X-Driver-Hub-Request')])).toEqual([
			['GET', null],
			['PUT', '1']
		]);
	});

	it('reports an ended session for management routes, not for wrong sign-in credentials', async () => {
		const onSessionEnded = vi.fn();
		const unauthorized = fakeBackend(401, { error: 'Sign-in required', code: 'unauthorized' });
		const api = createApiClient({ fetch: unauthorized.fetch, baseUrl, onSessionEnded });
		await api.POST('/auth/login', {
			body: { username: 'a', password: 'b' },
			params: { header: { 'X-Driver-Hub-Request': '1' } }
		});
		expect(onSessionEnded).not.toHaveBeenCalled();
		await api.GET('/deployments');
		expect(onSessionEnded).toHaveBeenCalledOnce();
	});
});

describe('unwrap', () => {
	it('returns data for successful responses', async () => {
		const api = createApiClient({ fetch: fakeBackend(200, { state: 'connected' }).fetch, baseUrl });
		await expect(unwrap(api.GET('/integrations/nomad'))).resolves.toEqual({ state: 'connected' });
	});

	it('throws the backend error code and details', async () => {
		const body = { error: 'Invalid', code: 'invalid_label', details: { field: 'label' } };
		const api = createApiClient({ fetch: fakeBackend(400, body).fetch, baseUrl });
		const error = await unwrap(api.GET('/capabilities')).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			status: 400,
			code: 'invalid_label',
			message: 'Invalid',
			transient: false
		});
		expect((error as ApiError).details).toEqual({ field: 'label' });
	});

	it('names an unknown failure by its status and marks upstream errors as transient', async () => {
		const api = createApiClient({ fetch: fakeBackend(502, 'not json').fetch, baseUrl });
		const error = await unwrap(api.GET('/capabilities')).catch((e: unknown) => e);
		expect(error).toMatchObject({ status: 502, code: 'http_502', transient: true });
	});

	it('turns a failed connection into a transient network error', async () => {
		const fetch = (() =>
			Promise.reject(new TypeError('Failed to fetch'))) as typeof globalThis.fetch;
		const api = createApiClient({ fetch, baseUrl });
		const error = await unwrap(api.GET('/capabilities')).catch((e: unknown) => e);
		expect(error).toMatchObject({ status: 0, code: NETWORK_ERROR, transient: true });
	});
});
