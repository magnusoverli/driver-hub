import { m } from '#lib/paraglide/messages.js';
import { ApiError, NETWORK_ERROR } from './errors';

/**
 * A sentence for a failed request. The manager's own explanation is used where it is specific;
 * an internal error carries no useful detail, and a network failure is described in our words.
 */
export function errorMessage(error: unknown): string {
	if (!(error instanceof ApiError)) return m.error_unexpected();
	if (error.code === NETWORK_ERROR) return m.error_unreachable();
	if (error.status === 500) return m.error_unexpected();
	return error.message;
}

/** Field errors the manager reports for `invalid_settings`, joined to field names. */
export function fieldErrors(error: unknown): { field: string; code: string }[] {
	if (!(error instanceof ApiError)) return [];
	const fields = error.details?.fields;
	if (!Array.isArray(fields)) return [];
	return fields.filter(
		(entry): entry is { field: string; code: string } =>
			typeof entry === 'object' &&
			entry !== null &&
			typeof (entry as { field?: unknown }).field === 'string' &&
			typeof (entry as { code?: unknown }).code === 'string'
	);
}
