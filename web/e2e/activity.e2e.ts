import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './environment.mjs';
import { signIn } from './support';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const operations = [
	{
		id: '11111111-0000-4000-8000-000000000001',
		kind: 'retain',
		state: 'running',
		target: { driverId: 'exampleco-meter', version: '1.5.0' },
		startedAt: ago(42_000)
	},
	{
		id: '11111111-0000-4000-8000-000000000002',
		kind: 'build',
		state: 'failed',
		target: { driverId: 'rust-example', commit: 'f64a319caf5f27fd46ef2ce203c71e6aa63f3d4c' },
		startedAt: ago(3_600_000),
		finishedAt: ago(3_480_000),
		failure: { error: 'Buildx failed to build this driver', code: 'build_failed', status: 422 }
	},
	{
		id: '11111111-0000-4000-8000-000000000003',
		kind: 'retain',
		state: 'interrupted',
		target: { driverId: 'acme-gateway', version: '2.1.0' },
		startedAt: ago(86_400_000)
	},
	{
		id: '11111111-0000-4000-8000-000000000004',
		kind: 'retain',
		state: 'succeeded',
		target: { driverId: 'exampleco-meter', version: '1.4.0' },
		startedAt: ago(90_000_000),
		finishedAt: ago(89_990_000),
		release: { driverId: 'exampleco-meter', version: '1.4.0', digest: `sha256:${'a'.repeat(64)}` }
	}
];

function answerOperations(page: Page, list: unknown[]) {
	return page.route('**/api/v1/operations', (route) =>
		route.fulfill({ json: { operations: list } })
	);
}

test('activity lists downloads and builds with their outcome, and filters what needs attention', async ({
	page
}) => {
	await answerOperations(page, operations);
	await signIn(page, ADMIN, '/activity');
	const table = page.getByRole('table', { name: 'Downloads and builds' });
	await expect(table.getByRole('row')).toHaveCount(5);
	await expect(table.getByRole('row', { name: /exampleco-meter 1\.5\.0/ })).toContainText(
		'In progress'
	);
	const build = table.getByRole('row', { name: /rust-example/ });
	await expect(build).toContainText('Source build');
	await expect(build).toContainText('at f64a319caf5f');
	await expect(build).toContainText('Buildx failed to build this driver');
	await expect(build).toContainText('2m');
	await expect(table.getByRole('row', { name: /acme-gateway/ })).toContainText(
		'The manager restarted while this ran'
	);
	await expect(table.getByRole('row', { name: /1\.4\.0/ })).toContainText('sha256:aaaaaaaaaaaa');
	await expect(page.getByText('Interrupted operations (1)')).toBeVisible();

	await page.getByRole('radio', { name: /Needs attention/ }).click();
	await expect(table.getByRole('row')).toHaveCount(3);
	await page.getByRole('radio', { name: /Completed/ }).click();
	await expect(table.getByRole('row')).toHaveCount(2);
});

test('with nothing to show, activity points to the catalog', async ({ page }) => {
	await answerOperations(page, []);
	await signIn(page, ADMIN, '/activity');
	await expect(page.getByRole('heading', { name: 'No downloads or builds yet' })).toBeVisible();
	await page.getByRole('link', { name: 'Open the catalog' }).click();
	await expect(page).toHaveURL('/catalog');
});

test('a running download is followed until it completes', async ({ page }) => {
	let state = 'running';
	await page.route('**/api/v1/operations', (route) =>
		route.fulfill({
			json: {
				operations: [
					{
						...operations[0],
						state,
						...(state === 'succeeded' && {
							finishedAt: new Date().toISOString(),
							release: {
								driverId: 'exampleco-meter',
								version: '1.5.0',
								digest: `sha256:${'b'.repeat(64)}`
							}
						})
					}
				]
			}
		})
	);
	await signIn(page, ADMIN, '/activity');
	const row = page.getByRole('row', { name: /exampleco-meter 1\.5\.0/ });
	await expect(row).toContainText('In progress');
	state = 'succeeded';
	await expect(row).toContainText('Completed');
	await expect(row).toContainText('sha256:bbbbbbbbbbbb');
});
