import { expect, test } from '@playwright/test';
import { ADMIN } from './environment.mjs';
import { createAccount, fillSignIn, signIn } from './support';

test('an administrator adds an account, and the new operator signs in with its role', async ({
	page,
	browser
}) => {
	const username = `Operator-${Date.now().toString(36)}`;
	const password = 'a-long-enough-password';
	await signIn(page, ADMIN, '/site/users');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add an account' });
	await dialog.getByLabel('Username').fill(username);
	await dialog.getByLabel('Password', { exact: true }).fill('too short');
	await dialog.getByLabel('Confirm password').fill('too short');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog.getByText('Use at least 12 characters.')).toBeVisible();
	await dialog.getByLabel('Password', { exact: true }).fill(password);
	await dialog.getByLabel('Confirm password').fill(password);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).toBeHidden();

	// Usernames are stored in lower case.
	const name = username.toLowerCase();
	await expect(page.getByText(`Account ${name} was added`)).toBeVisible();
	const row = page.getByRole('row', { name: new RegExp(name) });
	await expect(row).toContainText('Viewer');
	await expect(row).toContainText('Allowed');

	await page.getByRole('button', { name: 'Add account' }).click();
	await dialog.getByLabel('Username').fill(name);
	await dialog.getByLabel('Password', { exact: true }).fill(password);
	await dialog.getByLabel('Confirm password').fill(password);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog.getByText('An account with this username already exists.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel' }).click();

	const context = await browser.newContext();
	const other = await context.newPage();
	await other.goto('/');
	await fillSignIn(other, { username, password });
	await expect(other.getByRole('link', { name: 'Users' })).toHaveCount(0);
	await context.close();
});

test('changing an account ends its sessions, and disabled accounts cannot sign in', async ({
	page,
	browser
}) => {
	const username = `disable-${Date.now().toString(36)}`;
	const password = 'another-long-password';
	await signIn(page, ADMIN, '/site/users');
	await page.getByRole('button', { name: 'Add account' }).click();
	const create = page.getByRole('dialog', { name: 'Add an account' });
	await create.getByLabel('Username').fill(username);
	await create.getByLabel('Administrator').check();
	await create.getByLabel('Password', { exact: true }).fill(password);
	await create.getByLabel('Confirm password').fill(password);
	await create.getByRole('button', { name: 'Add account' }).click();
	await expect(page.getByRole('row', { name: new RegExp(username) })).toContainText(
		'Administrator'
	);

	await page.getByRole('button', { name: `Edit ${username}` }).click();
	const edit = page.getByRole('dialog', { name: `Edit ${username}` });
	await expect(edit.getByRole('button', { name: 'Save changes' })).toBeDisabled();
	await edit.getByLabel('Viewer').check();
	await edit.getByLabel('Allow this account to sign in').uncheck();
	await edit.getByRole('button', { name: 'Save changes' }).click();
	await expect(
		page.getByText(`Account ${username} was updated and its sessions ended`)
	).toBeVisible();
	const row = page.getByRole('row', { name: new RegExp(username) });
	await expect(row).toContainText('Viewer');
	await expect(row).toContainText('Disabled');

	const context = await browser.newContext();
	const other = await context.newPage();
	await other.goto('/');
	await fillSignIn(other, { username, password });
	await expect(other.getByRole('alert')).toContainText('incorrect, or the account is disabled');
	await context.close();
});

test('an account is deleted after typing its name; your own account has no delete', async ({
	page,
	request
}) => {
	const account = await createAccount(request, 'viewer');
	await signIn(page, ADMIN, '/site/users');
	await expect(
		page.getByRole('button', { name: `Delete ${ADMIN.username}`, exact: true })
	).toHaveCount(0);
	await page.getByRole('button', { name: `Delete ${account.username}`, exact: true }).click();
	const dialog = page.getByRole('dialog', { name: `Delete ${account.username}` });
	const confirm = dialog.getByRole('button', { name: 'Delete account' });
	await expect(confirm).toBeDisabled();
	await dialog.getByLabel(`Type ${account.username} to confirm`).fill(account.username);
	await confirm.click();
	await expect(page.getByText(`Account ${account.username} was deleted`)).toBeVisible();
	await expect(page.getByRole('row', { name: new RegExp(account.username) })).toHaveCount(0);
});
