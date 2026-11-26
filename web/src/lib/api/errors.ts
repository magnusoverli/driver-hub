import type { components } from './schema';

type ErrorBody = components['schemas']['Error'];

/** Status 0 means the request never got an HTTP response. */
export const NETWORK_ERROR = 'network_error';

/** A failed management API request, carrying the backend's stable error code. */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details: Record<string, unknown> | undefined;

	constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.details = details;
	}

	/** Whether repeating the identical request may succeed without anyone changing anything. */
	get transient(): boolean {
		return this.status === 0 || this.status === 429 || this.status >= 500;
	}

	static fromBody(status: number, body: unknown): ApiError {
		const error = isErrorBody(body) ? body : undefined;
		return new ApiError(
			status,
			error?.code ?? `http_${status}`,
			error?.error ?? `Request failed with HTTP ${status}`,
			error?.details
		);
	}

	static network(cause: unknown): ApiError {
		const error = new ApiError(0, NETWORK_ERROR, 'Driver Hub could not be reached');
		error.cause = cause;
		return error;
	}
}

function isErrorBody(body: unknown): body is ErrorBody {
	return (
		typeof body === 'object' &&
		body !== null &&
		typeof (body as ErrorBody).error === 'string' &&
		typeof (body as ErrorBody).code === 'string'
	);
}

export function isApiError(error: unknown, code?: string): error is ApiError {
	return error instanceof ApiError && (code === undefined || error.code === code);
}
