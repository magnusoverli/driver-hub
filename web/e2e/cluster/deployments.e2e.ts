import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, FAKE_NOMAD_URL } from '../environment.mjs';
import { createAccount, signIn } from '../support';
import { changeElsewhere, DEVICES, resetCluster, stubUpdates } from './fixture';

const { studio, gateway, control, truck, migrated } = DEVICES;
const detail = (nodeId: string) => `/deployments/${nodeId}`;

test.beforeEach(async ({ page }) => {
	await resetCluster();
	await stubUpdates(page);
});

function statusOf(page: Page) {
	return page.getByRole('region', { name: 'Status' });
}

async function openAction(page: Page, button: string) {
	await page.getByRole('button', { name: button, exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText('Asking Nomad for a plan…')).toBeHidden();
	// Let the opening animation finish, so contrast is measured at full opacity.
	await dialog.evaluate((element) =>
		Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished))
	);
	return dialog;
}

test('the list shows each device with what Hub can verify, and keeps the view in the address', async ({
	page
}) => {
	await stubUpdates(page, [
		{
			nodeId: control.nodeId,
			driverId: 'exampleco-meter',
			version: '1.4.0',
			availableVersion: '1.5.0'
		}
	]);
	await signIn(page, ADMIN, '/deployments');
	const rows = page.getByRole('table', { name: 'Deployments' }).getByRole('row');
	await expect(rows).toHaveCount(7);

	const row = (name: string | RegExp) => page.getByRole('row', { name });
	await expect(row(/Studio 3 meter/)).toContainText('Driver reports connected');
	await expect(row(/Studio 3 meter/)).toContainText('Update 1.4.0 ready');
	await expect(row(/Control room meter/)).toContainText('Control check failed');
	await expect(row(/Control room meter/)).toContainText('1.5.0 published');
	await expect(row(/Rack B gateway/)).toContainText('Waiting for allocation');
	await expect(row(/Truck 2 meter/)).toContainText('Status unavailable');
	await expect(row(/Edit suite meter/)).toContainText('Replaces external driver');
	await expect(row(/Unnamed device/)).toContainText('Stopped');
	await expect(row(/Studio 3 meter/).getByRole('img')).toHaveAccessibleName(
		'Requested: verified, Allocation: verified, Control: verified, Approval: not observable'
	);

	await page.getByRole('radio', { name: /Needs attention/ }).click();
	await expect(rows).toHaveCount(3);
	await expect(page).toHaveURL('/deployments?show=attention');
	await page.getByLabel('Filter deployments').fill('truck');
	await expect(rows).toHaveCount(2);
	await expect(page.getByText('Showing 1 of 6')).toBeVisible();

	await page.reload();
	await expect(page.getByLabel('Filter deployments')).toHaveValue('truck');
	await expect(page.getByRole('radio', { name: /Needs attention/ })).toBeChecked();
	await page.getByLabel('Filter deployments').fill('no such device');
	await page.getByRole('button', { name: 'Show all deployments' }).click();
	await expect(rows).toHaveCount(7);
	await expect(page).toHaveURL('/deployments');
});

test('a device explains each step to control and shows its Nomad history', async ({ page }) => {
	await signIn(page, ADMIN, '/deployments');
	await page.getByRole('link', { name: 'Rack B gateway' }).click();
	await expect(page).toHaveURL(detail(gateway.nodeId));
	await expect(page.getByRole('heading', { level: 1, name: 'Rack B gateway' })).toBeVisible();

	const status = statusOf(page);
	await page.getByText('Diagnostics, configuration and device details').click();
	await expect(status).toContainText(/Placed on nomad-client-\d, but not running yet \(pending\)/);
	await expect(status).toContainText('This release declares no control check');
	await expect(status).toContainText('Approval happens in VideoIPath');
	const allocation = page.getByRole('table', { name: 'Allocations' }).getByRole('row').nth(1);
	const allocationId = await allocation.locator('code').getAttribute('title');
	await expect(allocation.getByRole('link', { name: 'Nomad logs' })).toHaveAttribute(
		'href',
		`${FAKE_NOMAD_URL}/ui/allocations/${allocationId}/driver/logs?namespace=default`
	);

	await page.getByRole('tab', { name: /Scheduler evaluations/ }).click();
	const evaluations = page.getByRole('table', { name: 'Scheduler evaluations' });
	await expect(evaluations.getByRole('row', { name: /blocked/ })).toContainText(
		'3 clients evaluated, 2 filtered out, 1 without capacity'
	);
	await expect(evaluations).toContainText('memory');

	await page.getByRole('tab', { name: /Version history/ }).click();
	const history = page.getByRole('table', { name: 'Version history' });
	await expect(history.getByRole('row')).toHaveCount(3);
	await expect(history.getByRole('row').nth(1)).toContainText('Current');

	await expect(page.getByRole('region', { name: 'Configuration' })).toContainText(
		'gw-rack-b.site.example'
	);
});

test('an administrator stops and starts a driver, reviewing Nomad’s plan first', async ({
	page
}) => {
	await signIn(page, ADMIN, detail(studio.nodeId));

	let dialog = await openAction(page, 'Stop');
	await expect(dialog.getByRole('definition').nth(1)).toHaveText(/Running\s*changes to\s*Stopped/);
	await expect(dialog).toContainText('VideoIPath loses control of this device');
	await dialog.getByRole('button', { name: 'Stop driver' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText(/^Stop submitted \(revision \d+\)$/)).toBeVisible();
	await page.getByText('Diagnostics, configuration and device details').click();
	await expect(statusOf(page)).toContainText(
		'No allocation is wanted while the deployment is stopped.'
	);

	dialog = await openAction(page, 'Start');
	await expect(dialog.getByText('Nomad can place the driver now')).toBeVisible();
	await dialog.getByRole('button', { name: 'Start driver' }).click();
	await expect(page.getByText(/^Start submitted \(revision \d+\)$/)).toBeVisible();
	await expect(statusOf(page)).toContainText(/Running on nomad-client-\d\./);
	await expect(statusOf(page)).toContainText('reported VideoIPath and the device connected');
});

test('an update keeps the previous version and configuration for rollback', async ({ page }) => {
	await signIn(page, ADMIN, detail(studio.nodeId));
	await page.getByRole('button', { name: 'Update…' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('radio', { name: /1\.4\.0/ })).toBeChecked();
	await dialog.getByRole('button', { name: 'Preview update' }).click();
	await expect(dialog.getByText('Nomad can place the driver now')).toBeVisible();
	await dialog.getByRole('button', { name: 'Update to 1.4.0' }).click();
	await expect(page.getByText(/^Update to 1\.4\.0 submitted/)).toBeVisible();
	const device = page.getByRole('region', { name: 'Device' });
	await page.getByText('Diagnostics, configuration and device details').click();
	await expect(device).toContainText('Previous: 1.3.0');

	await page.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('menuitem', { name: 'Roll back to 1.3.0' }).click();
	await expect(dialog).toContainText('Changes made on the device itself are not undone');
	await dialog.getByRole('button', { name: 'Roll back to 1.3.0' }).click();
	await expect(page.getByText(/^Rollback to 1\.3\.0 submitted/)).toBeVisible();
	await expect(page.getByText('exampleco-meter 1.3.0')).toBeVisible();
	await expect(device).toContainText('Previous: 1.4.0');
});

test('an update that needs new configuration is refused with the missing fields', async ({
	page
}) => {
	await signIn(page, ADMIN, detail(gateway.nodeId));
	await page.getByRole('button', { name: 'Update…' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Preview update' }).click();
	await expect(dialog.getByRole('alert')).toContainText(
		'The target version needs configuration this deployment does not have.'
	);
	await expect(dialog.getByRole('alert')).toContainText('region is required');
	await expect(dialog.getByRole('button', { name: /Update to/ })).toHaveCount(0);

	// Back to the configuration the new version needs, starting from the current one.
	await dialog.getByRole('button', { name: 'Change configuration' }).click();
	await expect(dialog.getByLabel('deviceHost')).toHaveValue('gw-rack-b.site.example');
	await expect(dialog.getByLabel('port (optional)')).toHaveValue('9001');
	await expect(dialog.getByLabel('region')).toHaveAccessibleDescription(/Required\./);
	await dialog.getByLabel('region').fill('eu-north');
	await dialog.getByRole('button', { name: 'Preview update' }).click();
	await dialog.getByRole('button', { name: 'Update to 2.1.0' }).click();
	await expect(page.getByText(/^Update to 2\.1\.0 submitted/)).toBeVisible();
	const configuration = page.getByRole('region', { name: 'Configuration' });
	await page.getByText('Diagnostics, configuration and device details').click();
	await expect(configuration).toContainText('eu-north');
	await expect(configuration).toContainText('9001');
});

test('a migrated device starts only once the original driver is confirmed stopped', async ({
	page
}) => {
	await signIn(page, ADMIN, detail(migrated.nodeId));
	await expect(page.getByText('Replaces an external driver')).toBeVisible();
	const dialog = await openAction(page, 'Start');
	const start = dialog.getByRole('button', { name: 'Start driver' });
	await expect(start).toBeDisabled();
	await dialog.getByLabel('The original external driver for this device is stopped').check();
	await start.click();
	await expect(page.getByText(/^Start submitted/)).toBeVisible();
	await expect(page.getByText('Replaces an external driver')).toBeHidden();
});

test('a change made elsewhere meanwhile is reported instead of overwritten', async ({ page }) => {
	await signIn(page, ADMIN, detail(studio.nodeId));
	const dialog = await openAction(page, 'Stop');
	await changeElsewhere(studio.nodeId, 'update', { version: '1.4.0' });
	await dialog.getByRole('button', { name: 'Stop driver' }).click();
	await expect(dialog.getByText(/changed after you opened this preview/)).toBeVisible();
	await dialog.getByRole('button', { name: 'Review current state' }).click();
	await expect(dialog).toContainText('1.4.0');
	await expect(dialog.getByRole('button', { name: 'Stop driver' })).toBeEnabled();
});

test('naming a device changes neither the driver nor its revision', async ({ page }) => {
	await signIn(page, ADMIN, detail(studio.nodeId));
	const revision = page.getByRole('region', { name: 'Device' }).getByRole('definition').last();
	await page.getByText('Diagnostics, configuration and device details').click();
	const before = await revision.textContent();

	await page.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('menuitem', { name: 'Rename device' }).click();
	const dialog = page.getByRole('dialog', { name: 'Name this device' });
	await dialog.getByLabel('Device name').fill('   ');
	await dialog.getByRole('button', { name: 'Save name' }).click();
	await expect(dialog.getByText('Enter a name, or remove it.')).toBeVisible();
	await dialog.getByLabel('Device name').fill('  Studio 3 loudness meter ');
	await dialog.getByRole('button', { name: 'Save name' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Studio 3 loudness meter');
	await expect(revision).toHaveText(before ?? '');

	await page.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('menuitem', { name: 'Rename device' }).click();
	await dialog.getByRole('button', { name: 'Remove name' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Unnamed device');
});

test('viewers can preview changes, but not apply them or rename devices', async ({
	page,
	request
}) => {
	const viewer = await createAccount(request, 'viewer');
	await signIn(page, viewer, detail(control.nodeId));
	await page.getByText('Diagnostics, configuration and device details').click();
	await expect(statusOf(page)).toContainText('reported a failure');
	const dialog = await openAction(page, 'Preview stop');
	await expect(dialog).toContainText('You can preview changes; an administrator applies them.');
	await expect(dialog.getByRole('button', { name: 'Stop driver' })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);
});

test('unknown and unreadable devices are reported rather than left loading', async ({ page }) => {
	await signIn(page, ADMIN, '/deployments/00000000-0000-4000-8000-000000000000');
	await expect(page.getByRole('heading', { level: 1, name: 'Deployment not found' })).toBeVisible();
	await page.goto('/deployments/not-a-node-id');
	await expect(page.getByRole('heading', { level: 1, name: 'Deployment not found' })).toBeVisible();

	await page.goto(detail(truck.nodeId));
	await expect(page.getByRole('alert')).toContainText('The deployment could not be loaded', {
		timeout: 20_000
	});
	await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
	test.describe(`${colorScheme} theme`, () => {
		test.use({ colorScheme });

		test('deployment pages meet WCAG 2.2 AA', async ({ page }) => {
			const audit = async () => {
				const { violations } = await new AxeBuilder({ page })
					.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
					.analyze();
				return violations.map(
					(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
				);
			};
			await signIn(page, ADMIN, '/deployments');
			await expect(page.getByRole('table', { name: 'Deployments' })).toBeVisible();
			expect(await audit()).toEqual([]);

			await page.goto(detail(gateway.nodeId));
			await page.getByText('Diagnostics, configuration and device details').click();
			await page.getByRole('tab', { name: /Scheduler evaluations/ }).click();
			await expect(page.getByRole('table', { name: 'Scheduler evaluations' })).toBeVisible();
			expect(await audit()).toEqual([]);

			await openAction(page, 'Stop');
			expect(await audit()).toEqual([]);
		});
	});
}
