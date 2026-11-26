import createClient, { type Middleware } from 'openapi-fetch';
import { ApiError } from './errors';
import type { paths } from './schema';

export type ApiClient = ReturnType<typeof createClient<paths>>;

export interface ApiClientOptions {
	/** Called when a signed-in request is rejected because the session ended. */
	onSessionEnded?: () => void;
	fetch?: typeof globalThis.fetch;
	baseUrl?: string;
}

const API_BASE = '/api/v1';
const AUTH_PREFIX = `${API_BASE}/auth/`;

/**
 * The backend requires this header on every non-GET request made with a session cookie.
 * A cross-site form cannot set it, which is how the manager rejects request forgery.
 */
const browserWrite: Middleware = {
	onRequest({ request }) {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			request.headers.set('X-Driver-Hub-Request', '1');
		}
		return request;
	}
};

/**
 * A 401 from a management route means the session cookie is no longer valid: the manager
 * restarted, the session expired, or an admin changed this account. Sign-in routes answer
 * 401 for wrong credentials instead, so they are excluded.
 */
function sessionWatch(onSessionEnded: () => void): Middleware {
	return {
		onResponse({ request, response }) {
			if (response.status === 401 && !new URL(request.url).pathname.startsWith(AUTH_PREFIX)) {
				onSessionEnded();
			}
			return response;
		}
	};
}

export function createApiClient({
	onSessionEnded,
	fetch,
	baseUrl = API_BASE
}: ApiClientOptions = {}): ApiClient {
	const client = createClient<paths>({
		baseUrl,
		fetch,
		credentials: 'same-origin',
		headers: { Accept: 'application/json' }
	});
	client.use(browserWrite);
	if (onSessionEnded) client.use(sessionWatch(onSessionEnded));
	return client;
}

interface FetchResult<T> {
	data?: T;
	error?: unknown;
	response: Response;
}

/** Resolves an openapi-fetch call to its data, or throws an {@link ApiError}. */
export async function unwrap<T>(call: Promise<FetchResult<T>>): Promise<T> {
	let result: FetchResult<T>;
	try {
		result = await call;
	} catch (cause) {
		throw ApiError.network(cause);
	}
	if (!result.response.ok) throw ApiError.fromBody(result.response.status, result.error);
	return result.data as T;
}
