import type { ApiClient } from '#lib/api/client.js';
import { ApiError } from '#lib/api/errors.js';
import { operationKey } from '#lib/api/operation-key.js';
import type { Schema } from '#lib/api/types.js';
import { acquireRelease, type BuildInput, type Identity } from './queries';

export type Acquired =
	| { kind: 'operation'; operation: Schema<'Operation'> }
	| { kind: 'release'; release: Schema<'Release'> };

/**
 * Request keys of downloads and builds whose answer was lost. Retrying the same request reuses
 * its key, so the manager returns the running operation instead of starting a second one.
 */
const pendingKeys = new Map<string, string>();

/** Downloads a published release or builds a source revision, in the background when possible. */
export async function acquire(
	api: ApiClient,
	input: Identity | BuildInput,
	background: boolean
): Promise<Acquired> {
	const payload = 'commit' in input ? input : { driverId: input.driverId, version: input.version };
	const fingerprint = JSON.stringify(payload);
	const key = background ? (pendingKeys.get(fingerprint) ?? operationKey()) : undefined;
	if (key) pendingKeys.set(fingerprint, key);
	try {
		const result = await acquireRelease(api, payload, key);
		pendingKeys.delete(fingerprint);
		return 'state' in result
			? { kind: 'operation', operation: result }
			: { kind: 'release', release: result };
	} catch (error) {
		// A definite refusal ends the request; anything else may still be running on the manager.
		if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
			pendingKeys.delete(fingerprint);
		}
		throw error;
	}
}
