import { expect, test } from '@playwright/test';
import { createAccount, fillSignIn, openAccountMenu, signIn, updateAccount } from './support';
import { SERVICE_TOKEN } from './environment.mjs';

test('a first-login session can only change the default password or sign out', async ({
	page,
	request
}) => {
	const account = { username: `bootstrap-${Date.now()}`, password: 'LicenseToDeploy!' };
	const created = await request.post('/api/v1/users', {
		headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
		data: { ...account, role: 'admin' }
	});
	expect(created.status()).toBe(200);
	await page.goto('/settings/users');
	await fillSignIn(page, account);
	const dialog = page.getByRole('dialog', { name: 'Change password' });
	await expect(dialog).toBeVisible();
	await page.reload();
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Sign out' }).click();
	await fillSignIn(page, account);
	const newPassword = `${account.username}-new-password`;
	await expect(dialog.getByLabel('Current password')).toHaveCount(0);
	await dialog.getByLabel('New password', { exact: true }).fill(newPassword);
	await dialog.getByLabel('Confirm new password').fill(newPassword);
	await dialog.getByRole('button', { name: 'Change password' }).click();
	await expect(
		page.getByRole('status').filter({ hasText: 'Your password was changed.' })
	).toBeVisible();
	await expect(page).toHaveURL('/settings/users');
	await page.reload();
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});

test('a session ended by an admin change resumes in place with the new permissions', async ({
	page,
	request
}) => {
	const operator = await createAccount(request, 'admin');
	await signIn(page, operator, '/deployments');
	await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();

	// Changing the role revokes every session of this operator on the manager.
	await updateAccount(request, operator.username, { role: 'viewer' });

	// The next poll is rejected, and the app asks for the password without leaving the page.
	const dialog = page.getByRole('dialog', { name: 'Your session has ended' });
	await expect(dialog).toBeVisible({ timeout: 20_000 });
	await expect(page).toHaveURL('/deployments');
	await expect(dialog.getByLabel('Username')).toHaveValue(operator.username);
	await expect(dialog.getByLabel('Password')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeVisible();

	await dialog.getByLabel('Password').fill(operator.password);
	await dialog.getByRole('button', { name: 'Sign in and continue' }).click();
	await expect(dialog).toBeHidden();
	await expect(page).toHaveURL('/deployments');
	await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^Account:.*Viewer$/ })).toBeVisible();
});

test('changing the password signs the operator out and only the new password works', async ({
	page,
	request
}) => {
	const operator = await createAccount(request, 'viewer');
	const newPassword = `${operator.password}-renewed`;
	await signIn(page, operator);
	await openAccountMenu(page);
	await page.getByRole('menuitem', { name: 'Change password' }).click();

	const dialog = page.getByRole('dialog', { name: 'Change password' });
	await dialog.getByLabel('Current password').fill(operator.password);
	await dialog.getByLabel('New password', { exact: true }).fill(newPassword);
	await dialog.getByLabel('Confirm new password').fill(newPassword);
	await dialog.getByRole('button', { name: 'Change password' }).click();

	await expect(page).toHaveURL('/login');
	await expect(page.getByText('Your password was changed.')).toBeVisible();
	await fillSignIn(page, operator);
	await expect(page.getByRole('alert')).toContainText('incorrect');
	await fillSignIn(page, { ...operator, password: newPassword });
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});

test('viewers see no site administration and cannot open it directly', async ({
	page,
	request
}) => {
	const viewer = await createAccount(request, 'viewer');
	await signIn(page, viewer);
	const nav = page.getByRole('navigation', { name: 'Main' });
	await expect(nav.getByRole('link')).toHaveText([
		'Overview',
		'Deployments',
		'Catalog',
		'Activity'
	]);
	await expect(page.getByText('An administrator needs to complete the items below')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Open settings' })).toHaveCount(0);

	await page.goto('/settings/users');
	await expect(page.getByRole('heading', { name: 'Administrator access required' })).toBeVisible();

	await page.keyboard.press('Control+k');
	await page.getByPlaceholder('Type a page or an action').fill('users');
	await expect(page.getByText('No matching pages or actions.')).toBeVisible();
});
