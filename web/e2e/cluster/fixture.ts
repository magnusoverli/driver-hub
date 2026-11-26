import type { Page } from '@playwright/test';
import { CLUSTER_BASE_URL, FAKE_NOMAD_URL, SERVICE_TOKEN } from '../environment.mjs';
import { DEVICES, seedCluster } from './seed.mjs';

export { DEVICES };

/** Every test starts from the same seeded devices, whatever the previous one changed. */
export function resetCluster(): Promise<void> {
	return seedCluster({
		managerUrl: CLUSTER_BASE_URL,
		nomadUrl: FAKE_NOMAD_URL,
		token: SERVICE_TOKEN
	});
}

export type UpdateSuggestion = {
	nodeId: string;
	driverId: string;
	version: string;
	availableVersion: string;
};

/**
 * Update suggestions come from GitHub through the manager. Tests answer them in the browser
 * instead, so they neither depend on the public repository nor run into its rate limit.
 */
export async function stubUpdates(page: Page, updates: UpdateSuggestion[] = []): Promise<void> {
	await page.route('**/api/v1/updates', (route) => route.fulfill({ json: { updates } }));
}

/** Changes the deployment as another operator would, through the service API. */
export async function changeElsewhere(
	nodeId: string,
	action: 'start' | 'stop' | 'update',
	body: Record<string, unknown> = {}
): Promise<void> {
	const headers = { Authorization: `Bearer ${SERVICE_TOKEN}`, 'Content-Type': 'application/json' };
	const current = await fetch(`${CLUSTER_BASE_URL}/api/v1/deployments/${nodeId}`, { headers });
	const { revision } = (await current.json()) as { revision: number };
	const response = await fetch(`${CLUSTER_BASE_URL}/api/v1/deployments/${nodeId}/${action}`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ revision, ...body })
	});
	if (!response.ok)
		throw new Error(`${action} failed: ${response.status} ${await response.text()}`);
}
