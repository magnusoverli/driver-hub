import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { createApiClient } from '#lib/api/client.js';
import type { Preview } from './lifecycle.js';
import type { Deployment } from './queries.js';
import LifecycleHarness from './testing/LifecycleHarness.svelte';

const nodeId = '11111111-1111-4111-8111-111111111111';
const digest = (char: string) => `sha256:${char.repeat(64)}`;

const stopped: Deployment = {
	nodeId,
	driverId: 'meter',
	version: '1.4.0',
	label: 'Edit suite meter',
	settings: {},
	revision: 7,
	image: `images.test/driverhub/k@${digest('a')}`,
	requiresOriginalStopped: false,
	inheritsSite: false,
	previousVersion: null,
	communication: 'unknown',
	approval: 'unknown',
	communicationEvidence: { state: 'unknown', reason: 'stopped' },
	requested: 'stopped',
	allocations: []
};

const plan = (overrides: Partial<Preview> = {}): Preview => ({
	preview: true,
	requested: 'running',
	image: stopped.image,
	currentRevision: 7,
	schedulable: true,
	placementFailures: [],
	...overrides
});

type Route = (request: Request, body: Record<string, unknown>) => Response;

/** A manager that answers previews and submissions through the given handlers. */
function fakeManager(handlers: { preview?: Route; apply?: Route }) {
	const calls: { dryRun: boolean; body: Record<string, unknown> }[] = [];
	const fetch = vi.fn(async (request: Request) => {
		const body = (await request.json()) as Record<string, unknown>;
		const dryRun = new URL(request.url).searchParams.get('dryRun') === 'true';
		calls.push({ dryRun, body });
		const handler = dryRun ? handlers.preview : handlers.apply;
		return handler?.(request, body) ?? Response.json(plan());
	});
	const api = createApiClient({
		fetch: fetch as typeof globalThis.fetch,
		baseUrl: 'http://hub.test/api/v1'
	});
	return { api, calls };
}

const error = (status: number, code: string, details?: unknown) =>
	Response.json({ error: code, code, details }, { status });

describe('LifecycleDialog', () => {
	it('shows viewers the plan but no way to apply it', async () => {
		const { api, calls } = fakeManager({});
		await render(LifecycleHarness, { api, action: 'start', deployment: stopped, canApply: false });
		await expect.element(page.getByText('Nomad can place the driver now')).toBeVisible();
		await expect
			.element(page.getByText('You can preview changes; an administrator applies them.'))
			.toBeVisible();
		expect(page.getByRole('button', { name: 'Start driver' }).elements()).toHaveLength(0);
		expect(calls).toEqual([{ dryRun: true, body: { revision: 7 } }]);
	});

	it('starts a migrated device only after the original driver is confirmed stopped', async () => {
		const onApplied = vi.fn();
		const { api, calls } = fakeManager({
			apply: () => Response.json({ nodeId, revision: 8 })
		});
		await render(LifecycleHarness, {
			api,
			action: 'start',
			deployment: { ...stopped, requiresOriginalStopped: true },
			onApplied
		});
		const start = page.getByRole('button', { name: 'Start driver' });
		await expect.element(start).toBeDisabled();
		await userEvent.click(
			page.getByLabelText('The original external driver for this device is stopped')
		);
		await expect.element(start).toBeEnabled();
		await userEvent.click(start);
		await expect.element(page.getByTestId('dialog-state')).toHaveTextContent('closed');
		expect(calls.at(-1)).toEqual({
			dryRun: false,
			body: { revision: 7, originalStopped: true }
		});
		expect(onApplied).toHaveBeenCalledWith({
			action: 'start',
			version: '1.4.0',
			submission: { nodeId, revision: 8 }
		});
	});

	it('does not offer to apply a plan Nomad cannot place, and says why', async () => {
		const { api } = fakeManager({
			preview: () =>
				Response.json(
					plan({
						schedulable: false,
						placementFailures: [
							{
								group: 'device',
								nodesEvaluated: 3,
								nodesFiltered: 3,
								nodesExhausted: 0,
								constraints: { '${attr.cpu.arch}': 3 },
								resources: {}
							}
						]
					})
				)
		});
		await render(LifecycleHarness, { api, action: 'start', deployment: stopped });
		await expect.element(page.getByText('Nomad cannot place the driver')).toBeVisible();
		await expect.element(page.getByText('${attr.cpu.arch}')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Start driver' })).toBeDisabled();
	});

	it('plans again against the current state after someone else changed the deployment', async () => {
		const { api, calls } = fakeManager({
			preview: (_request, body) =>
				Response.json(plan({ currentRevision: body.revision as number })),
			apply: () => error(409, 'revision_conflict', { currentRevision: 9 })
		});
		await render(LifecycleHarness, {
			api,
			action: 'start',
			deployment: stopped,
			reloaded: { ...stopped, revision: 9 }
		});
		await userEvent.click(page.getByRole('button', { name: 'Start driver' }));
		// A warning, announced politely rather than as an alert.
		await expect.element(page.getByText(/changed after you opened this preview/)).toBeVisible();
		await userEvent.click(page.getByRole('button', { name: 'Review current state' }));
		await expect.element(page.getByRole('button', { name: 'Start driver' })).toBeEnabled();
		expect(calls.map((call) => [call.dryRun, call.body.revision])).toEqual([
			[true, 7],
			[false, 7],
			[true, 9]
		]);
	});

	it('asks to check the state instead of retrying when the outcome is unknown', async () => {
		const { api, calls } = fakeManager({ apply: () => error(502, 'upstream_error') });
		await render(LifecycleHarness, { api, action: 'start', deployment: stopped });
		await userEvent.click(page.getByRole('button', { name: 'Start driver' }));
		await expect.element(page.getByText(/may have been applied/)).toBeVisible();
		expect(page.getByRole('button', { name: 'Start driver' }).elements()).toHaveLength(0);
		await userEvent.click(page.getByRole('button', { name: 'Close and reload' }));
		await expect.element(page.getByTestId('dialog-state')).toHaveTextContent('closed');
		expect(calls.filter((call) => !call.dryRun)).toHaveLength(1);
	});

	it('lets the operator choose the version before planning an update', async () => {
		const { api, calls } = fakeManager({
			preview: () => Response.json(plan({ image: `images.test/driverhub/k@${digest('b')}` }))
		});
		await render(LifecycleHarness, {
			api,
			action: 'update',
			deployment: { ...stopped, requested: 'running' },
			targets: [
				{ version: '1.5.0', displayName: 'Meter', origin: 'maintainer', newer: true },
				{ version: '1.3.0', displayName: 'Meter', origin: 'maintainer', newer: false }
			]
		});
		await expect.element(page.getByLabelText(/1\.5\.0/)).toBeChecked();
		await userEvent.click(page.getByLabelText(/1\.3\.0/));
		await userEvent.click(page.getByRole('button', { name: 'Preview update' }));
		await expect.element(page.getByRole('button', { name: 'Update to 1.3.0' })).toBeEnabled();
		expect(calls).toEqual([{ dryRun: true, body: { revision: 7, version: '1.3.0' } }]);
	});
});
