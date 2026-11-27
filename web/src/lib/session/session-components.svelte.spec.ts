import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { ApiError } from '#lib/api/errors.js';
import type { AuthService, Operator } from './auth-service.js';
import { Session } from './session.svelte.js';
import SessionHarness from './testing/SessionHarness.svelte';

const admin: Operator = { username: 'admin', role: 'admin', provider: 'local' };

function fakeAuth(overrides: Partial<AuthService> = {}): AuthService {
	return {
		current: () => Promise.resolve(null),
		signIn: vi.fn(() => Promise.resolve(admin)),
		signOut: () => Promise.resolve(),
		changePassword: vi.fn(() => Promise.resolve(null)),
		...overrides
	};
}

describe('SignInForm', () => {
	it('enables sign-in once both fields are filled and reports success', async () => {
		const auth = fakeAuth();
		const onSignedIn = vi.fn();
		await render(SessionHarness, { session: new Session(auth), view: 'sign-in', onSignedIn });
		const submit = page.getByRole('button', { name: 'Sign in' });
		await expect.element(submit).toBeDisabled();
		await expect.element(page.getByLabelText('Username')).toHaveFocus();
		await userEvent.fill(page.getByLabelText('Username'), '  admin ');
		await userEvent.fill(page.getByLabelText('Password'), 'correct horse');
		await userEvent.click(submit);
		await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
		expect(auth.signIn).toHaveBeenCalledWith('admin', 'correct horse');
	});

	it('explains a refusal, clears the password and returns focus to it', async () => {
		const refused = new ApiError(401, 'invalid_credentials', 'Invalid username or password');
		await render(SessionHarness, {
			session: new Session(fakeAuth({ signIn: () => Promise.reject(refused) })),
			view: 'sign-in',
			username: 'admin'
		});
		const password = page.getByLabelText('Password');
		await expect.element(password).toHaveFocus();
		await userEvent.fill(password, 'wrong');
		await userEvent.keyboard('{Enter}');
		await expect.element(page.getByRole('alert')).toBeVisible();
		await expect
			.element(page.getByText('The username or password is incorrect, or the account is disabled.'))
			.toBeVisible();
		await expect.element(password).toHaveValue('');
		await expect.element(password).toHaveFocus();
	});
});

describe('ChangePasswordDialog', () => {
	it('validates locally before asking the manager', async () => {
		const auth = fakeAuth();
		await render(SessionHarness, { session: new Session(auth), view: 'change-password' });
		await userEvent.fill(page.getByLabelText('Current password'), 'old-password');
		await userEvent.fill(page.getByLabelText('New password', { exact: true }), 'short');
		await userEvent.click(page.getByRole('button', { name: 'Change password' }));
		await expect.element(page.getByText('Use at least 12 characters.')).toBeVisible();
		await userEvent.fill(
			page.getByLabelText('New password', { exact: true }),
			'a-long-new-password'
		);
		await userEvent.fill(page.getByLabelText('Confirm new password'), 'a-long-new-passwort');
		await expect.element(page.getByText('The passwords do not match.')).toBeVisible();
		expect(auth.changePassword).not.toHaveBeenCalled();
	});

	it('shows a wrong current password on that field and closes after success', async () => {
		const changePassword = vi
			.fn<AuthService['changePassword']>()
			.mockRejectedValueOnce(new ApiError(401, 'invalid_credentials', 'Invalid'))
			.mockResolvedValueOnce(null);
		const session = new Session(fakeAuth({ changePassword }));
		await session.signIn('admin', 'x');
		await render(SessionHarness, { session, view: 'change-password' });
		await userEvent.fill(page.getByLabelText('Current password'), 'not-it');
		await userEvent.fill(
			page.getByLabelText('New password', { exact: true }),
			'a-long-new-password'
		);
		await userEvent.fill(page.getByLabelText('Confirm new password'), 'a-long-new-password');
		await userEvent.click(page.getByRole('button', { name: 'Change password' }));
		await expect.element(page.getByText('The current password is incorrect.')).toBeVisible();
		await userEvent.fill(page.getByLabelText('Current password'), 'old-password');
		await userEvent.click(page.getByRole('button', { name: 'Change password' }));
		await expect.element(page.getByTestId('dialog-state')).toHaveTextContent('closed');
		expect(session.lastSignOut).toBe('password-changed');
	});
});
