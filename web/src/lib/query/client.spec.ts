import { describe, expect, it } from 'vitest';
import { ApiError } from '#lib/api/errors.js';
import { shouldRetry } from './client.js';

describe('query retries', () => {
	it('retries what may succeed unchanged, at most twice', () => {
		expect(shouldRetry(0, ApiError.network(null))).toBe(true);
		expect(shouldRetry(1, new ApiError(502, 'upstream_error', 'x'))).toBe(true);
		expect(shouldRetry(0, new ApiError(429, 'busy', 'x'))).toBe(true);
		expect(shouldRetry(2, ApiError.network(null))).toBe(false);
	});

	it('does not repeat requests the manager refused', () => {
		for (const status of [400, 401, 403, 404, 409, 422]) {
			expect(shouldRetry(0, new ApiError(status, 'refused', 'x'))).toBe(false);
		}
	});
});
