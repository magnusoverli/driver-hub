import { queryOptions } from '@tanstack/svelte-query';
import { unwrap, type ApiClient } from '#lib/api/client.js';
import type { Schema } from '#lib/api/types.js';
import { m } from '#lib/paraglide/messages.js';
import type { Role } from '#lib/session/auth-service.js';

export type Account = Schema<'LocalAccount'>;
export type AccountChanges = { role?: Role; enabled?: boolean; password?: string };

export const userKeys = {
	all: ['users'] as const,
	list: () => [...userKeys.all, 'list'] as const
};

export function usersQuery(api: ApiClient) {
	return queryOptions({
		queryKey: userKeys.list(),
		queryFn: async () => (await unwrap(api.GET('/users'))).users
	});
}

export function createAccount(
	api: ApiClient,
	input: { username: string; role: Role; password: string }
): Promise<Account> {
	return unwrap(api.POST('/users', { body: input }));
}

export function updateAccount(
	api: ApiClient,
	username: string,
	changes: AccountChanges
): Promise<Account> {
	return unwrap(api.PATCH('/users/{username}', { params: { path: { username } }, body: changes }));
}

/** Deletes a local account and ends its sessions. The last enabled administrator is refused. */
export function deleteAccount(api: ApiClient, username: string) {
	return unwrap(api.DELETE('/users/{username}', { params: { path: { username } } }));
}

/** The manager stores usernames in lower case and compares them without regard to case. */
export function normalizeUsername(value: string): string {
	return value.trim().toLowerCase();
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Mirrors the manager's rule, after normalizing. */
export function usernameProblem(value: string): string | null {
	const username = normalizeUsername(value);
	if (!username) return m.users_error_username_required();
	if (!USERNAME.test(username)) return m.users_error_username_format();
	return null;
}

/** Administrators first, then alphabetically, so the accounts that matter most lead the list. */
export function sortAccounts(accounts: readonly Account[]): Account[] {
	return [...accounts].sort(
		(a, b) =>
			Number(b.role === 'admin') - Number(a.role === 'admin') ||
			a.username.localeCompare(b.username)
	);
}

/** Whether a change would leave no enabled administrator, which the manager refuses. */
export function removesLastAdmin(
	accounts: readonly Account[],
	username: string,
	changes: AccountChanges
): boolean {
	return !accounts.some((account) => {
		const role = account.username === username ? (changes.role ?? account.role) : account.role;
		const enabled =
			account.username === username ? (changes.enabled ?? account.enabled) : account.enabled;
		return role === 'admin' && enabled;
	});
}

/** Only what differs from the account, so an unchanged role does not count as a change. */
export function accountChanges(
	account: Account,
	edited: { role: Role; enabled: boolean; password?: string }
): AccountChanges {
	const changes: AccountChanges = {};
	if (edited.role !== account.role) changes.role = edited.role;
	if (edited.enabled !== account.enabled) changes.enabled = edited.enabled;
	if (edited.password) changes.password = edited.password;
	return changes;
}
