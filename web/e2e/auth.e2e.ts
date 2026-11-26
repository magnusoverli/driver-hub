import { expect, test } from '@playwright/test';
import { ADMIN } from './environment.mjs';
import { createAccount, fillSignIn, openAccountMenu, signIn, updateAccount } from './support';

test('a deep link asks for sign-in and then continues to the requested page', async ({ page }) => {
	await page.goto('/catalog');
	await expect(page).toHaveURL('/login?next=%2Fcatalog');
	await expect(page.getByRole('heading', { name: 'Sign in to Driver Hub' })).toBeVisible();
	await fillSignIn(page, ADMIN);
	await expect(page).toHaveURL('/catalog');
	await expect(page.getByRole('heading', { level: 1, name: 'Catalog' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Catalog' })).toHaveAttribute('aria-current', 'page');
});

test('refused credentials get one message that reveals nothing about the account', async ({
	page,
	request
}) => {
	const disabled = await createAccount(request, 'viewer');
	await updateAccount(request, disabled.username, { enabled: false });
	await page.goto('/login');
	for (const attempt of [{ ...ADMIN, password: 'not-the-password' }, disabled]) {
		await fillSignIn(page, attempt);
		await expect(page.getByRole('alert')).toHaveText(
			'The username or password is incorrect, or the account is disabled.'
		);
		await expect(page.getByLabel('Password')).toHaveValue('');
		await expect(page).toHaveURL('/login');
	}
});

test('signing out returns to the sign-in page and protects the app again', async ({ page }) => {
	await signIn(page, ADMIN, '/deployments');
	await openAccountMenu(page);
	await page.getByRole('menuitem', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByText('You have signed out.')).toBeVisible();
	await page.goto('/');
	await expect(page).toHaveURL('/login');
	expect((await page.context().cookies()).filter((c) => c.name.includes('driverhub'))).toEqual([]);
});

test('an unreachable manager is reported, and the app recovers when it returns', async ({
	page
}) => {
	await page.route('**/api/v1/auth/session', (route) => route.abort('connectionrefused'));
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Driver Hub is not responding' })).toBeVisible();
	await page.unroute('**/api/v1/auth/session');
	await page.getByRole('button', { name: 'Try again' }).click();
	await expect(page.getByRole('heading', { name: 'Sign in to Driver Hub' })).toBeVisible();
});
