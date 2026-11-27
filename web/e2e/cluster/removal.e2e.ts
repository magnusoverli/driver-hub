import { expect, test } from '@playwright/test';
import { ADMIN } from '../environment.mjs';
import { signIn } from '../support';
import { DEVICES, resetCluster, stubUpdates } from './fixture';

const { studio, spare, control } = DEVICES;

test.beforeEach(async ({ page }) => {
	await resetCluster();
	await stubUpdates(page);
});

test('a stopped device is deleted after typing its name, and the list reports it', async ({
	page
}) => {
	await signIn(page, ADMIN, `/deployments/${spare.nodeId}`);
	await page.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('menuitem', { name: 'Delete deployment…' }).click();
	const dialog = page.getByRole('dialog', { name: 'Delete Unnamed device' });
	await expect(dialog).toContainText(`nomad/jobs/driverhub-${spare.nodeId}`);
	const confirm = dialog.getByRole('button', { name: 'Delete deployment' });
	await expect(confirm).toBeDisabled();
	// Unnamed, so the first block of its node ID is typed instead.
	await dialog
		.getByLabel(`Type ${spare.nodeId.slice(0, 8)} to confirm`)
		.fill(spare.nodeId.slice(0, 8));
	await confirm.click();
	await expect(page).toHaveURL('/deployments');
	await expect(page.getByText('Unnamed device was deleted')).toBeVisible();
	await expect(page.getByRole('table', { name: 'Deployments' }).getByRole('row')).toHaveCount(6);
	await page.goto(`/deployments/${spare.nodeId}`);
	await expect(page.getByRole('heading', { level: 1, name: 'Deployment not found' })).toBeVisible();
});

test('a running device cannot be deleted until it is stopped', async ({ page }) => {
	await signIn(page, ADMIN, `/deployments/${studio.nodeId}`);
	await page.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('menuitem', { name: 'Delete deployment…' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText('Stop the deployment first')).toBeVisible();
	await expect(dialog.getByRole('textbox')).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Delete deployment' })).toBeDisabled();
});

test('with shared writers on, deletion is explained and refused before anything is typed', async ({
	page
}) => {
	await signIn(page, ADMIN, '/settings/nomad');
	const jobs = page.getByRole('region', { name: 'Jobs', exact: true });
	await jobs.getByLabel("Other tools also change Hub's jobs").check();
	await jobs.getByRole('button', { name: 'Save' }).click();
	await expect(jobs.getByText('Saved. New jobs and device pages use these values.')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Current connection' })).toContainText(
		'On: deployments cannot be deleted'
	);

	await page.goto(`/deployments/${spare.nodeId}`);
	await page.getByRole('button', { name: 'More actions' }).click();
	await page.getByRole('menuitem', { name: 'Delete deployment…' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText('Deleting is turned off on this site')).toBeVisible();
	await expect(dialog.getByRole('textbox')).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Delete deployment' })).toBeDisabled();
	await dialog.getByRole('link', { name: 'Open the Nomad settings' }).click();
	await expect(page).toHaveURL('/settings/nomad');
});

test('a release that devices still use is not removed, and they are named', async ({ page }) => {
	await signIn(page, ADMIN, '/catalog/exampleco-meter/1.4.0');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('ExampleCo Meter');
	await expect(page.getByRole('region', { name: 'Devices on this version' })).toContainText(
		'Control room meter'
	);
	await page.getByRole('button', { name: 'Remove…' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: 'Remove release' }).click();
	await expect(dialog.getByText('Devices still need this release:')).toBeVisible();
	await expect(dialog.getByRole('link', { name: 'Control room meter' })).toBeVisible();
	await expect(dialog).toContainText('runs it');
});

test('the overview leads with devices that need attention and updates waiting', async ({
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
	await signIn(page, ADMIN, '/');
	const devices = page.getByRole('region', { name: 'Devices' });
	await expect(devices.getByRole('link', { name: /^2\s*Needs attention$/ })).toBeVisible();
	const attention = devices.getByRole('list', { name: 'Devices that need attention' });
	await expect(attention.getByRole('listitem')).toHaveCount(2);
	await expect(attention).toContainText('Control check failed');
	const updates = page.getByRole('region', { name: 'Updates' });
	await expect(
		updates.getByRole('listitem').filter({ hasText: 'Control room meter' })
	).toContainText('1.4.0 → 1.5.0');
	await expect(updates.getByRole('listitem').filter({ hasText: 'Studio 3 meter' })).toContainText(
		'downloaded'
	);
	await devices.getByRole('link', { name: /Needs attention/ }).click();
	await expect(page).toHaveURL('/deployments?show=attention');
	await expect(page.getByRole('table', { name: 'Deployments' }).getByRole('row')).toHaveCount(3);
});

test('the command palette jumps to a device or a release by name', async ({ page }) => {
	await signIn(page, ADMIN, '/');
	await page.getByRole('button', { name: /Search or jump to/ }).click();
	await page.getByPlaceholder('Type a page or an action').fill('control room');
	await page.getByRole('option', { name: /Control room meter/ }).click();
	await expect(page).toHaveURL(`/deployments/${control.nodeId}`);

	await page.keyboard.press('Control+k');
	await page.getByPlaceholder('Type a page or an action').fill('acme 2.1.0');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL('/catalog/acme-gateway/2.1.0');
	await expect(page.getByRole('table', { name: 'Inputs' })).toContainText('region');
});
