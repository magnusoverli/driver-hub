import { QueryClient } from '@tanstack/svelte-query';
import { ApiError } from '#lib/api/errors.js';

/**
 * How often live status is polled. The manager has no push channel, so freshness is shown next
 * to the data instead. Polling stops while the tab is hidden (TanStack's default).
 */
export const POLL_INTERVAL_MS = 10_000;

/** Retries only what may succeed unchanged: network failures, rate limits and upstream errors. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
	if (failureCount >= 2) return false;
	return !(error instanceof ApiError) || error.transient;
}

export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 5_000,
				retry: shouldRetry,
				refetchOnWindowFocus: true
			},
			mutations: { retry: false }
		}
	});
}
