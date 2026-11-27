import { expect, test } from '@playwright/test';
import { ADMIN, BASE_URL, SERVICE_TOKEN } from './environment.mjs';
import { createAccount, signIn } from './support';

test('the settings pages are listed under Settings, for administrators only', async ({
	page,
	browser,
	request
}) => {
	await signIn(page, ADMIN);
	const nav = page.getByRole('navigation', { name: 'Main' });
	await expect(nav.getByText('Settings', { exact: true })).toBeVisible();
	for (const name of ['Nomad cluster', 'VideoIPath', 'Users', 'API tokens', 'Manager'])
		await expect(nav.getByRole('link', { name })).toBeVisible();

	const viewer = await createAccount(request, 'viewer');
	const context = await browser.newContext();
	const other = await context.newPage();
	await signIn(other, viewer);
	await expect(
		other.getByRole('navigation', { name: 'Main' }).getByText('Settings', { exact: true })
	).toHaveCount(0);
	await context.close();
});

test('Nomad settings distinguish the Hub download address from the optional Nomad web link', async ({
	page
}) => {
	await signIn(page, ADMIN, '/settings/nomad');
	await expect(page.getByLabel('Hub download address')).toBeEmpty();
	const images = page.getByRole('region', { name: 'Image distribution' });
	await expect(images).toContainText('Not set up');
	await expect(images).toContainText(
		'Starts once the Nomad connection and Hub download address are set.'
	);

	const jobs = page.getByRole('region', { name: 'Jobs', exact: true });
	const ui = jobs.getByLabel('Nomad web interface');
	const saved = jobs.getByText('Saved. New jobs and device pages use these values.');
	await ui.fill('http://nomad.site.example');
	await jobs.getByRole('button', { name: 'Save' }).click();
	await expect(jobs.getByText('Enter an HTTPS address without a path')).toBeVisible();
	await ui.fill('https://nomad.site.example/');
	await jobs.getByRole('button', { name: 'Save' }).click();
	await expect(saved).toBeVisible();
	const current = page.getByRole('region', { name: 'Current connection' });
	await expect(current).toContainText('https://nomad.site.example');

	// The other tests expect a site without a Nomad web interface.
	await ui.fill('');
	await jobs.getByRole('button', { name: 'Save' }).click();
	await expect(saved).toBeVisible();
	await expect(current).not.toContainText('https://nomad.site.example');
});

test('an API token is shown once, acts with its role, and stops working when revoked', async ({
	page,
	playwright
}) => {
	const name = `Monitoring ${Date.now().toString(36)}`;
	await signIn(page, ADMIN, '/settings/api-tokens');
	// The e2e manager also starts with the emergency token.
	await expect(page.getByText('The emergency administrator token is set')).toBeVisible();

	await page.getByRole('button', { name: 'Create token' }).click();
	const dialog = page.getByRole('dialog', { name: 'Create an API token' });
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Viewer').check();
	await dialog.getByRole('button', { name: 'Create token' }).click();
	const shown = page.getByRole('dialog', { name: 'Copy the token now' });
	const token = (await shown.locator('code').textContent())?.trim() ?? '';
	expect(token).toMatch(/^dh_[\w-]{43}$/);
	await shown.getByRole('button', { name: 'Done' }).click();
	await expect(page.getByText(`Token ${name} was created`)).toBeVisible();
	const row = page.getByRole('row', { name: new RegExp(name) });
	await expect(row).toContainText('Viewer');
	await expect(row).toContainText(`by ${ADMIN.username}`);
	await expect(page.getByText(token)).toHaveCount(0);

	const script = await playwright.request.newContext({
		baseURL: BASE_URL,
		extraHTTPHeaders: { Authorization: `Bearer ${token}` }
	});
	const capabilities = (await (await script.get('/api/v1/capabilities')).json()) as {
		access: string;
	};
	expect(capabilities.access).toBe('viewer');
	expect((await script.get('/api/v1/api-tokens')).status()).toBe(403);

	await page.getByRole('button', { name: 'Create token' }).click();
	await dialog.getByLabel('Name').fill(name.toUpperCase());
	await dialog.getByRole('button', { name: 'Create token' }).click();
	await expect(dialog.getByText('A token with this name already exists.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel' }).click();

	await row.getByRole('button', { name: `Revoke ${name}` }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Revoke token' }).click();
	await expect(page.getByText(`Token ${name} was revoked`)).toBeVisible();
	await expect(row).toHaveCount(0);
	expect((await script.get('/api/v1/capabilities')).status()).toBe(401);
	await script.dispose();
});

test('the Manager page lists the startup settings and where each comes from, without secrets', async ({
	page
}) => {
	await signIn(page, ADMIN, '/settings/manager');
	const table = page.getByRole('table', { name: 'Startup settings' });
	const dataDir = table.getByRole('row', { name: /DRIVER_HUB_DATA_DIR/ });
	await expect(dataDir).toContainText('Data directory');
	await expect(dataDir).toContainText('Set in the environment');
	await expect(table.getByRole('row', { name: /DRIVER_HUB_SITE_KEY_FILE/ })).toContainText(
		'Default'
	);
	await expect(table.getByRole('row', { name: /DRIVER_HUB_ADMIN_TOKEN/ })).toContainText(
		'Set (not shown)'
	);
	await expect(page.getByText(SERVICE_TOKEN)).toHaveCount(0);
	await expect(page.getByText('environment section of compose.yaml')).toBeVisible();

	const features = page.getByRole('region', { name: 'Features' });
	const timings = features.getByLabel('Request timings');
	await timings.check();
	await features.getByRole('button', { name: 'Save' }).click();
	await expect(features.getByText('Saved.')).toBeVisible();
	await page.reload();
	await expect(timings).toBeChecked();
	await timings.uncheck();
	await features.getByRole('button', { name: 'Save' }).click();
	await expect(features.getByText('Saved.')).toBeVisible();
});
