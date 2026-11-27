import { expect, test } from '@playwright/test';
import { ADMIN } from '../environment.mjs';
import { signIn } from '../support';
import { resetCluster, stubUpdates } from './fixture';

test('a retained release works without GitHub and stages a new stopped device after preview', async ({
	page
}) => {
	await resetCluster();
	await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
	await stubUpdates(page);
	await page.route('**/api/v1/releases?*', (route) =>
		route.fulfill({ status: 403, json: { error: 'Upstream unavailable', code: 'upstream' } })
	);
	await signIn(page, ADMIN, '/catalog');
	await expect(page.getByText('Upstream unavailable')).toBeVisible();
	await page.getByRole('tab', { name: 'Retained releases' }).click();
	const row = page
		.getByRole('row')
		.filter({ hasText: 'exampleco-meter' })
		.filter({ hasText: '1.4.0' });
	await row.getByRole('link', { name: 'ExampleCo Meter' }).click();
	await expect(page).toHaveURL('/catalog/exampleco-meter/1.4.0');
	await expect(page.getByRole('table', { name: 'Inputs' })).toContainText('deviceCredential');
	await page.goBack();
	await row.getByRole('button', { name: 'Set up driver' }).click();
	const form = page.getByRole('dialog');
	await expect(form.getByLabel('deviceHost')).toBeVisible();
	await expect(form.getByLabel('pollSeconds')).toBeHidden();
	await form.getByLabel('Device name').fill('Catalog test meter');
	await form.getByLabel('deviceHost').fill('meter.example');
	await form.getByLabel('deviceCredential').fill('meter_token');
	await form.getByText('Optional settings').click();
	await form.getByLabel('pollSeconds').fill('13');
	await form.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(form).toHaveAccessibleName('Review device setup');
	await expect(form).toContainText('The driver stays stopped until you choose Start.');
	await expect(form.getByText('Node ID', { exact: true })).toBeHidden();
	await form.getByText('Technical details').click();
	await expect(form.getByText('Node ID', { exact: true })).toBeVisible();
	await expect(form).toContainText('meter_token');
	await form.getByRole('button', { name: 'Create deployment' }).click();
	await expect(page).toHaveURL(/\/deployments\/[0-9a-f-]{36}$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catalog test meter');
	await expect(page.getByText('Staged, not started yet')).toBeVisible();
	await expect(
		page.getByText(/Create these keys in the Nomad Variable nomad\/jobs\/driverhub-[0-9a-f-]{36}:/)
	).toBeVisible();
});

test('an external driver is replaced under its existing node ID, after its inputs are checked', async ({
	page
}) => {
	await resetCluster();
	await stubUpdates(page);
	await page.route('**/api/v1/releases?*', (route) => route.fulfill({ json: { releases: [] } }));
	const nodeId = crypto.randomUUID();
	await signIn(page, ADMIN, '/catalog');
	await page.getByRole('tab', { name: 'Retained releases' }).click();
	await page
		.getByRole('row')
		.filter({ hasText: 'exampleco-meter' })
		.filter({ hasText: '1.4.0' })
		.getByRole('button', { name: 'Set up driver' })
		.click();
	const form = page.getByRole('dialog');
	await form.getByLabel('Replace existing driver').check();
	await form.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(form.getByLabel('Device name')).toHaveAccessibleDescription(
		'Enter a name for the device.'
	);
	await expect(form.getByText('Enter the node ID.')).toBeVisible();
	await expect(form.getByLabel('deviceHost')).toHaveAccessibleDescription(/Required\./);
	await form.getByLabel('Device name').fill('Replacement meter');
	await form.getByLabel('Node ID of the existing driver').fill(nodeId);
	await form.getByLabel('deviceHost').fill('meter-edit2.site.example');
	await form.getByLabel('deviceCredential').fill('not a key name');
	await form.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(form.getByLabel('deviceCredential')).toHaveAccessibleDescription(
		/letters, digits and underscores/
	);
	await form.getByLabel('deviceCredential').fill('device_token');
	await form.getByText('Optional settings').click();
	await form.getByLabel('pollSeconds').fill('99');
	await form.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(form.getByLabel('pollSeconds')).toHaveAccessibleDescription(
		/Outside the allowed range/
	);
	await form.getByLabel('pollSeconds').fill('');
	await form.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(form).toContainText(nodeId);
	await expect(form).toContainText('Stop the original external driver.');
	await form.getByRole('button', { name: 'Create deployment' }).click();
	await expect(page).toHaveURL(`/deployments/${nodeId}`);
	await expect(page.getByText('Replaces an external driver')).toBeVisible();
});

test('a downloaded driver goes from the published catalog to a live deployment result', async ({
	page
}) => {
	await resetCluster();
	await page.route('**/api/v1/releases?*', (route) =>
		route.fulfill({
			json: { releases: [{ driverId: 'acme-gateway', version: '2.0.1', prerelease: false }] }
		})
	);
	await signIn(page, ADMIN, '/catalog');
	await page
		.getByRole('table', { name: 'Published releases' })
		.getByRole('button', { name: 'Set up driver' })
		.click();
	const form = page.getByRole('dialog');
	await expect(form.getByLabel('port (optional)')).toBeHidden();
	await form.getByLabel('Device name').fill('Gateway');
	await form.getByLabel('deviceHost').fill('gateway.site.example');
	await form.getByRole('button', { name: 'Preview' }).click();
	await form.getByRole('button', { name: 'Deploy driver' }).click();
	const result = page.getByRole('region', { name: 'Deployment result' });
	await expect(result.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
	await expect(page.getByRole('table', { name: 'Allocations' })).toBeHidden();
});
