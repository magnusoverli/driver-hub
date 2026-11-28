import { expect, test } from '@playwright/test';
import { ADMIN, FAKE_NOMAD_URL } from '../environment.mjs';
import { signIn } from '../support';
import { deleteDeployment, stageWithSite } from './fixture';

test('the Nomad page reports the connection and saves only after reaching the leader', async ({
	page
}) => {
	await signIn(page, ADMIN, '/settings/nomad');
	const current = page.getByRole('region', { name: 'Current connection' });
	await expect(current).toContainText('Connected');
	await expect(current).toContainText(FAKE_NOMAD_URL);

	const form = page.getByRole('region', { name: 'Change the connection' });
	// The fake cluster has ACLs disabled, so no token is saved and none can be kept.
	await expect(form.getByLabel('Keep the saved token')).toBeDisabled();
	await expect(form.getByLabel('No token')).toBeChecked();
	await form.getByLabel('Address', { exact: true }).fill('nomad.site.example/ui');
	await form.getByRole('button', { name: 'Check and save' }).click();
	await expect(form.getByText('Enter a host name, IP address or http(s) URL')).toBeVisible();

	await form.getByLabel('Address', { exact: true }).fill(FAKE_NOMAD_URL);
	await form.getByLabel('Hub download address').fill('hub.site.example');
	await form.getByLabel('Datacenters').fill('dc1, dc2');
	await form.getByRole('button', { name: 'Check and save' }).click();
	await expect(form.getByText('Saved. Hub reached the Nomad leader.')).toBeVisible();
	await expect(current).toContainText('dc1, dc2');
	await page.reload();
	await expect(form.getByLabel('Hub download address')).toHaveValue('hub.site.example');

	await form.getByLabel('Datacenters').fill('dc1');
	await form.getByRole('button', { name: 'Check and save' }).click();
	await expect(form.getByText('Saved. Hub reached the Nomad leader.')).toBeVisible();
	await expect(current).not.toContainText('dc2');
});

test('per-device tokens are added to a pool, and assignments show which device holds one', async ({
	page
}) => {
	await signIn(page, ADMIN, '/settings/videoipath');
	const form = page.getByRole('region', { name: 'Change the target' });
	await form.getByLabel('VideoIPath address').fill('vip.site.example');
	await expect(form.getByLabel('Use TLS (secure WebSocket)')).toBeChecked();
	await form.getByLabel('Use TLS (secure WebSocket)').uncheck();
	await expect(
		form.getByText('Drivers will connect to ws://vip.site.example/x-driver/v1.')
	).toBeVisible();
	await form.getByLabel('Use TLS (secure WebSocket)').check();
	await expect(
		form.getByText('Drivers will connect to wss://vip.site.example/x-driver/v1.')
	).toBeVisible();
	const tokens = Array.from({ length: 3 }, (_, i) => `e2e-token-${Date.now()}-${i}`);
	await form.getByLabel(/^Tokens/).fill(`${tokens.join('\n')}\n${tokens[0]}`);
	await expect(form.getByText('3 token(s) to add.')).toBeVisible();
	await page.route('**/api/v1/site/videoipath/check', (route) =>
		route.fulfill({
			json: {
				endpoint: 'wss://vip.site.example/x-driver/v1',
				state: 'unreachable',
				httpStatus: null
			}
		})
	);
	await form.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(form.getByText('VideoIPath settings saved. Tokens added: 3.')).toBeVisible();
	const current = page.getByRole('region', { name: 'Current target' });
	await expect(current.getByRole('status')).toContainText(/could not reach|timed out/);
	await expect(current).toContainText('wss://vip.site.example/x-driver/v1');
	await expect(current).toContainText(/\d+ unused, \d+ assigned/);
	// Saving again with nothing new is not offered.
	await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

	// Staging a device that uses the site reserves a token for it.
	const nodeId = await stageWithSite('VideoIPath pool meter');
	await page.reload();
	const row = page
		.getByRole('table', { name: 'Token pool' })
		.getByRole('row', { name: /VideoIPath pool meter/ });
	await expect(row).toBeVisible();
	await expect(row.getByRole('code')).toHaveText(/^[0-9a-f]{16}…$/);

	// An unused token is removed; the reserved one only once its device is deleted.
	const pool = page.getByRole('table', { name: 'Token pool' });
	const unused = pool.getByRole('row', { name: /Unused/ });
	const before = await unused.count();
	await unused
		.first()
		.getByRole('button', { name: /^Remove token/ })
		.click();
	await page.getByRole('dialog').getByRole('button', { name: 'Remove token' }).click();
	await expect(page.getByText(/^Token [0-9a-f]{16}… was removed from the pool$/)).toBeVisible();
	await expect(unused).toHaveCount(before - 1);
	await expect(row.getByRole('button', { name: /^Remove token/ })).toHaveCount(0);

	await deleteDeployment(nodeId);
	await page.reload();
	const released = pool.getByRole('row', { name: /Reserved for a deleted device/ });
	await released.getByRole('button', { name: /^Remove token/ }).click();
	await expect(page.getByRole('dialog')).toContainText(
		'reserved for a device that has been deleted'
	);
	await page.getByRole('dialog').getByRole('button', { name: 'Remove token' }).click();
	await expect(released).toHaveCount(0);
});
