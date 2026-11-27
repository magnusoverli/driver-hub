import { describe, expect, it } from 'vitest';
import {
	accountChanges,
	normalizeUsername,
	removesLastAdmin,
	sortAccounts,
	usernameProblem,
	type Account
} from './accounts';

const admin: Account = { username: 'admin', role: 'admin', enabled: true };
const viewer: Account = { username: 'operator', role: 'viewer', enabled: true };

describe('accounts', () => {
	it('mirrors the manager rule for usernames after normalizing them', () => {
		expect(normalizeUsername('  Ops.Team ')).toBe('ops.team');
		expect(usernameProblem('Ops.Team')).toBeNull();
		expect(usernameProblem('   ')).not.toBeNull();
		expect(usernameProblem('-leading')).not.toBeNull();
		expect(usernameProblem('has space')).not.toBeNull();
		expect(usernameProblem('x'.repeat(64))).toBeNull();
		expect(usernameProblem('x'.repeat(65))).not.toBeNull();
	});

	it('lists administrators first, then by name', () => {
		const accounts = [viewer, { ...admin, username: 'zed' }, admin];
		expect(sortAccounts(accounts).map((a) => a.username)).toEqual(['admin', 'zed', 'operator']);
	});

	it('refuses to remove the last enabled administrator, by demotion or by disabling', () => {
		expect(removesLastAdmin([admin, viewer], 'admin', { role: 'viewer' })).toBe(true);
		expect(removesLastAdmin([admin, viewer], 'admin', { enabled: false })).toBe(true);
		expect(removesLastAdmin([admin, viewer], 'operator', { enabled: false })).toBe(false);
		const disabledAdmin = { ...admin, username: 'other', enabled: false };
		expect(removesLastAdmin([admin, disabledAdmin], 'admin', { role: 'viewer' })).toBe(true);
		expect(
			removesLastAdmin([admin, { ...disabledAdmin, enabled: true }], 'admin', { role: 'viewer' })
		).toBe(false);
	});

	it('sends only what changed', () => {
		expect(accountChanges(viewer, { role: 'viewer', enabled: true })).toEqual({});
		expect(accountChanges(viewer, { role: 'admin', enabled: false, password: 'p' })).toEqual({
			role: 'admin',
			enabled: false,
			password: 'p'
		});
	});
});
