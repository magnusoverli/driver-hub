import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { SERVICE_TOKEN } from './environment.mjs';

export type Role = 'admin' | 'viewer';
export interface Account {
	username: string;
	password: string;
}

const service = { Authorization: `Bearer ${SERVICE_TOKEN}` };
let sequence = 0;

/** Creates an operator account through the service token, independent of any browser session. */
export async function createAccount(request: APIRequestContext, role: Role): Promise<Account> {
	const username = `${role}-${Date.now().toString(36)}-${sequence++}`;
	const account = { username, password: `${username}-password` };
	const response = await request.post('/api/v1/users', {
		headers: service,
		data: { ...account, role }
	});
	expect(response.status(), await response.text()).toBe(200);
	return account;
}

export async function updateAccount(
	request: APIRequestContext,
	username: string,
	changes: { role?: Role; enabled?: boolean; password?: string }
): Promise<void> {
	const response = await request.patch(`/api/v1/users/${username}`, {
		headers: service,
		data: changes
	});
	expect(response.status(), await response.text()).toBe(200);
}

export async function fillSignIn(page: Page, account: Account): Promise<void> {
	await page.getByLabel('Username').fill(account.username);
	await page.getByLabel('Password').fill(account.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Opens a page while signed out, signs in and waits for the application shell. */
export async function signIn(page: Page, account: Account, path = '/'): Promise<void> {
	await page.goto(path);
	await fillSignIn(page, account);
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

export function openAccountMenu(page: Page) {
	return page.getByRole('button', { name: /^Account:/ }).click();
}
