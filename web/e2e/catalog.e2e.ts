import { expect, test } from '@playwright/test';
import { ADMIN, SERVICE_TOKEN } from './environment.mjs';
import { createAccount, signIn } from './support';
import { ociArchive } from './cluster/seed.mjs';

const release = { driverId: 'exampleco-meter', version: '1.4.0' };

test('published prereleases can be downloaded and only become local after completion', async ({
	page
}) => {
	// Chromium exposes getRandomValues but not randomUUID on plain HTTP LAN origins.
	await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
	const keys: string[] = [];
	let state: 'idle' | 'running' | 'succeeded' = 'idle';
	const op = {
		id: crypto.randomUUID(),
		kind: 'retain',
		target: release,
		startedAt: new Date().toISOString()
	};
	await page.route('**/api/v1/releases?*', (route) =>
		route.fulfill({
			json: {
				releases:
					new URL(route.request().url()).searchParams.get('prerelease') === 'true'
						? [{ ...release, prerelease: true }]
						: []
			}
		})
	);
	await page.route('**/api/v1/retained', (route) =>
		route.fulfill({
			json: {
				releases:
					state === 'succeeded'
						? [
								{
									...release,
									displayName: 'Example Meter',
									origin: 'maintainer',
									digest: 'sha256:abc'
								}
							]
						: []
			}
		})
	);
	await page.route('**/api/v1/operations', (route) =>
		route.fulfill({ json: { operations: state === 'idle' ? [] : [{ ...op, state }] } })
	);
	await page.route('**/api/v1/retained/exampleco-meter/1.4.0', async (route) => {
		expect(route.request().method()).toBe('PUT');
		expect(route.request().headers()['prefer']).toBe('respond-async');
		const key = route.request().headers()['idempotency-key'];
		expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		keys.push(key);
		if (keys.length === 1) return route.abort('connectionreset');
		state = 'running';
		await route.fulfill({ status: 202, json: { ...op, state } });
	});
	await signIn(page, ADMIN, '/catalog');
	await expect(page.getByText(/No matching releases have been published/)).toBeVisible();
	await page.getByLabel('Include prereleases').check();
	const download = page.getByRole('button', { name: 'Download', exact: true });
	await download.click();
	await expect(page.getByRole('alert')).toBeVisible();
	expect(keys).toHaveLength(1);
	await download.click();
	const tasks = page.getByRole('table', { name: 'Recent downloads and builds' });
	await expect(tasks).toContainText('In progress');
	expect(keys).toEqual([keys[0], keys[0]]);
	state = 'succeeded';
	await expect(tasks).toContainText('Completed');
	await expect(page.getByRole('table', { name: 'Published releases' })).toContainText(
		'On this Hub'
	);
	await page.getByRole('tab', { name: 'Retained releases' }).click();
	await expect(page.getByRole('table', { name: 'Retained releases' })).toContainText(
		'Example Meter'
	);
});

test('a viewer can browse releases but cannot download or build them', async ({
	page,
	request
}) => {
	await page.route('**/api/v1/releases?*', (route) =>
		route.fulfill({ json: { releases: [{ ...release, prerelease: false }] } })
	);
	await signIn(page, await createAccount(request, 'viewer'), '/catalog');
	await expect(page.getByRole('link', { name: release.driverId })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
	await expect(page.getByRole('tab', { name: 'Source builds' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Import local image' })).toHaveCount(0);
});

test('an admin imports a local OCI archive without a cluster and sees the verified release', async ({
	page
}) => {
	await page.route('**/api/v1/releases?*', (route) => route.fulfill({ json: { releases: [] } }));
	await signIn(page, ADMIN, '/catalog');
	const driverId = 'uploaded-meter';
	const version = '1.2.0+local';
	const file = ociArchive(driverId);
	const configuration = JSON.stringify({
		schemaVersion: 1,
		controlHealth: { port: 8080, path: '/control' },
		inputs: []
	});
	const dialog = page.getByRole('dialog');
	async function fill(name: string) {
		await page.getByRole('button', { name: 'Import local image' }).click();
		await dialog.getByLabel('Driver ID', { exact: true }).fill(driverId);
		await dialog.getByLabel('Version', { exact: true }).fill(version);
		await dialog.getByText('Optional details', { exact: true }).click();
		await dialog.getByLabel('Display name', { exact: true }).fill(name);
		await dialog.getByLabel('Source commit', { exact: true }).fill('c'.repeat(40));
		await dialog.getByLabel('Source directory', { exact: true }).fill('Drivers/Meter');
		await dialog.getByLabel('Image archive', { exact: true }).setInputFiles({
			name: 'meter.oci.tar.gz',
			mimeType: 'application/gzip',
			buffer: file.bytes
		});
		await dialog
			.getByLabel('Configuration declaration (JSON)', { exact: true })
			.fill(configuration);
	}
	await fill('Uploaded meter');
	const submit = dialog.getByRole('button', { name: 'Import image', exact: true });
	await dialog.getByLabel('Configuration declaration (JSON)', { exact: true }).fill('not-json');
	await submit.click();
	await expect(dialog.getByText(/Enter a JSON object/)).toBeVisible();
	await dialog.getByLabel('Configuration declaration (JSON)', { exact: true }).fill(configuration);
	await submit.click();
	await expect(page.getByRole('tab', { name: 'Retained releases' })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await page.getByRole('link', { name: 'Uploaded meter' }).click();
	await expect(page).toHaveURL(`/catalog/${driverId}/${version}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Uploaded meter');
	await expect(page.getByTitle(file.digest)).toBeVisible();
	await expect(page.getByText('/control on port 8080')).toBeVisible();
	await page.goBack();

	await fill('Different content');
	await submit.click();
	await expect(dialog.getByRole('alert')).toContainText('Use a new version');
	await dialog.getByLabel('Display name', { exact: true }).fill('Uploaded meter');
	await submit.click();
	await expect(dialog).toBeHidden();
	await expect(
		page.getByText(`${driverId} ${version} is available in Retained releases.`)
	).toBeVisible();
});

test('the three required fields import a deployable release with no source metadata', async ({
	page
}) => {
	await page.route('**/api/v1/releases?*', (route) => route.fulfill({ json: { releases: [] } }));
	await signIn(page, ADMIN, '/catalog');
	await page.getByRole('button', { name: 'Import local image' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('Source commit', { exact: true })).toBeHidden();
	const help = dialog.getByRole('button', { name: 'Help: Driver ID' });
	await help.focus();
	await expect(page.getByRole('tooltip')).toContainText('Stable catalog ID');
	await help.press('Escape');
	await expect(dialog).toBeVisible();
	const driverId = 'minimal-import-meter';
	await dialog.getByLabel('Driver ID', { exact: true }).fill(driverId);
	await dialog.getByLabel('Version', { exact: true }).fill('1.0.0');
	await dialog.getByLabel('Image archive', { exact: true }).setInputFiles({
		name: 'meter.oci.tar.gz',
		mimeType: 'application/gzip',
		buffer: ociArchive(driverId).bytes
	});
	await dialog.getByRole('button', { name: 'Import image', exact: true }).click();
	await page.getByRole('link', { name: driverId, exact: true }).click();
	await expect(page.getByText('This driver declares no configuration inputs')).toBeVisible();
	await expect(page.getByText('Source commit', { exact: true })).toHaveCount(0);
	await expect(page.getByText('No control check declared')).toBeVisible();
});

test('a build-enabled site accepts a pinned source revision and shows build failure', async ({
	page
}) => {
	await page.route('**/api/v1/capabilities', async (route) => {
		const response = await route.fetch();
		const capabilities = (await response.json()) as Record<string, unknown>;
		await route.fulfill({ json: { ...capabilities, buildsEnabled: true } });
	});
	await page.route('**/api/v1/releases?*', (route) => route.fulfill({ json: { releases: [] } }));
	const commit = 'a'.repeat(40);
	const body = {
		driverId: 'exampleco-meter',
		commit,
		directory: 'Drivers/exampleco-meter',
		platform: 'linux/arm64'
	};
	const op = {
		id: crypto.randomUUID(),
		kind: 'build',
		target: { driverId: body.driverId, commit },
		startedAt: new Date().toISOString()
	};
	let submitted = false;
	await page.route('**/api/v1/builds', async (route) => {
		expect(route.request().postDataJSON()).toEqual(body);
		submitted = true;
		await route.fulfill({ status: 202, json: { ...op, state: 'running' } });
	});
	await page.route('**/api/v1/operations', (route) =>
		route.fulfill({
			json: {
				operations: submitted
					? [
							{
								...op,
								state: 'failed',
								failure: { error: 'Buildx failed', code: 'build_failed', status: 422 }
							}
						]
					: []
			}
		})
	);
	await signIn(page, ADMIN, '/catalog');
	await page.getByRole('tab', { name: 'Source builds' }).click();
	await page.getByLabel('Driver ID').fill(body.driverId);
	await page.getByLabel('Source commit').fill(commit);
	await page.getByLabel('Source directory').fill(body.directory);
	await page.getByLabel('Platform').selectOption(body.platform);
	await page.getByRole('button', { name: 'Build driver' }).click();
	const tasks = page.getByRole('table', { name: 'Recent downloads and builds' });
	await expect(tasks.getByRole('row', { name: /Source build/ })).toContainText('Failed');
	await expect(tasks).toContainText('Buildx failed');
	await page
		.getByRole('region', { name: 'Recent downloads and builds' })
		.getByRole('link', { name: 'View all activity' })
		.click();
	await expect(page).toHaveURL('/activity');
	await expect(page.getByRole('table', { name: 'Downloads and builds' })).toContainText(
		'Buildx failed'
	);
});

test('a removed customer release leaves the catalog, after typing its version', async ({
	page,
	request
}) => {
	await page.route('**/api/v1/releases?*', (route) => route.fulfill({ json: { releases: [] } }));
	const driverId = 'removable-meter';
	const imported = await request.put(`/api/v1/imports/${driverId}/3.0.0`, {
		headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
		multipart: {
			image: {
				name: 'image.oci.tar.gz',
				mimeType: 'application/gzip',
				buffer: ociArchive(driverId).bytes
			}
		}
	});
	expect(imported.status(), await imported.text()).toBe(201);
	await signIn(page, ADMIN, `/catalog/${driverId}/3.0.0`);
	await page.getByRole('button', { name: 'Remove…' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('This is a customer build');
	await dialog.getByLabel('Type 3.0.0 to confirm').fill('3.0.0');
	await dialog.getByRole('button', { name: 'Remove release' }).click();
	await expect(page).toHaveURL('/catalog');
	await expect(page.getByText(`${driverId} 3.0.0 was removed from this Hub`)).toBeVisible();
	await page.getByRole('tab', { name: 'Retained releases' }).click();
	await expect(page.getByRole('link', { name: driverId })).toHaveCount(0);
});

test('the import form explains missing and malformed fields before uploading', async ({ page }) => {
	await page.route('**/api/v1/releases?*', (route) => route.fulfill({ json: { releases: [] } }));
	let uploads = 0;
	await page.route('**/api/v1/imports/**', (route) => {
		uploads++;
		return route.abort();
	});
	await signIn(page, ADMIN, '/catalog');
	await page.getByRole('button', { name: 'Import local image' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Import image', exact: true }).click();
	await expect(dialog.getByLabel('Driver ID', { exact: true })).toHaveAccessibleDescription(
		/Enter the driver ID\./
	);
	await expect(dialog.getByLabel('Image archive', { exact: true })).toHaveAccessibleDescription(
		/no larger than 2 GiB/
	);
	await dialog.getByLabel('Driver ID', { exact: true }).fill('Not_Valid');
	await dialog.getByLabel('Version', { exact: true }).fill('1.0');
	await expect(dialog.getByText('Use lowercase letters and digits')).toBeVisible();
	await expect(dialog.getByText('Use a SemVer version such as 1.2.0.')).toBeVisible();
	expect(uploads).toBe(0);
});
