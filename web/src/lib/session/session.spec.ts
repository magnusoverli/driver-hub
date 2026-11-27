import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '#lib/api/errors.js';
import type { AuthService, Operator } from './auth-service.js';
import { Session } from './session.svelte.js';

const admin: Operator = { username: 'admin', role: 'admin', provider: 'local' };
const viewer: Operator = { username: 'watcher', role: 'viewer', provider: 'ldap' };

function fakeAuth(overrides: Partial<AuthService> = {}): AuthService {
	return {
		current: vi.fn(() => Promise.resolve(null)),
		signIn: vi.fn(() => Promise.resolve(admin)),
		signOut: vi.fn(() => Promise.resolve()),
		changePassword: vi.fn(() => Promise.resolve(null)),
		...overrides
	};
}

describe('Session', () => {
	it('restores an existing session, or reports that there is none', async () => {
		const restored = new Session(fakeAuth({ current: () => Promise.resolve(admin) }));
		await restored.restore();
		expect(restored.status).toBe('signed-in');
		expect(restored.isAdmin).toBe(true);
		expect(restored.managesOwnPassword).toBe(true);

		const anonymous = new Session(fakeAuth());
		await anonymous.restore();
		expect(anonymous.status).toBe('signed-out');
		expect(anonymous.operator).toBeNull();
	});

	it('distinguishes an unreachable manager from a missing session', async () => {
		const session = new Session(
			fakeAuth({ current: () => Promise.reject(ApiError.network(null)) })
		);
		await session.restore();
		expect(session.status).toBe('unavailable');
	});

	it('keeps the operator when the session expires so they can resume', async () => {
		const onOperatorChanged = vi.fn();
		const session = new Session(fakeAuth(), { onOperatorChanged });
		await session.signIn('admin', 'secret');
		session.expire();
		expect(session.status).toBe('expired');
		expect(session.operator).toEqual(admin);

		await session.signIn('admin', 'secret');
		expect(session.status).toBe('signed-in');
		expect(onOperatorChanged).not.toHaveBeenCalled();
	});

	it('discards the previous operator’s data when someone else resumes the session', async () => {
		const onOperatorChanged = vi.fn();
		const signIn = vi.fn().mockResolvedValueOnce(admin).mockResolvedValueOnce(viewer);
		const session = new Session(fakeAuth({ signIn }), { onOperatorChanged });
		await session.signIn('admin', 'secret');
		session.expire();
		await session.signIn('watcher', 'secret');
		expect(onOperatorChanged).toHaveBeenCalledOnce();
		expect(session.isAdmin).toBe(false);
		expect(session.managesOwnPassword).toBe(false);
	});

	it('leaves the session unchanged when sign-in is refused', async () => {
		const refused = new ApiError(401, 'invalid_credentials', 'Invalid username or password');
		const session = new Session(fakeAuth({ signIn: () => Promise.reject(refused) }));
		await expect(session.signIn('admin', 'wrong')).rejects.toBe(refused);
		expect(session.status).toBe('restoring');
		expect(session.operator).toBeNull();
	});

	it('only expires a signed-in session', () => {
		const session = new Session(fakeAuth());
		session.expire();
		expect(session.status).toBe('restoring');
	});

	it('signs out locally even when the manager cannot be told', async () => {
		const onOperatorChanged = vi.fn();
		const failing = fakeAuth({ signOut: () => Promise.reject(ApiError.network(null)) });
		const session = new Session(failing, { onOperatorChanged });
		await session.signIn('admin', 'secret');
		await expect(session.signOut()).rejects.toBeInstanceOf(ApiError);
		expect(session.status).toBe('signed-out');
		expect(session.lastSignOut).toBe('signed-out');
		expect(onOperatorChanged).toHaveBeenCalledOnce();
	});

	it('ends the session after a password change, as the manager does', async () => {
		const auth = fakeAuth();
		const session = new Session(auth);
		await session.signIn('admin', 'secret');
		await session.changePassword('secret', 'a-much-longer-secret');
		expect(auth.changePassword).toHaveBeenCalledWith('secret', 'a-much-longer-secret');
		expect(session.status).toBe('signed-out');
		expect(session.lastSignOut).toBe('password-changed');
	});
});
