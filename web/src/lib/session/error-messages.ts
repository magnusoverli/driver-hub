import { ApiError, NETWORK_ERROR } from '#lib/api/errors.js';
import { m } from '#lib/paraglide/messages.js';

/** The backend gives the same answer for unknown users, wrong passwords and disabled accounts. */
export function signInErrorMessage(error: unknown): string {
	if (!(error instanceof ApiError)) return m.error_unexpected();
	if (error.code === NETWORK_ERROR) return m.error_unreachable();
	if (error.status === 401) return m.signin_error_invalid();
	if (error.status === 429) return m.signin_error_throttled();
	return m.error_unexpected();
}

export type PasswordChangeProblem = { field: 'current' | 'new' | 'form'; message: string };

export function passwordChangeProblem(error: unknown): PasswordChangeProblem {
	if (error instanceof ApiError) {
		if (error.status === 401) return { field: 'current', message: m.password_error_current() };
		if (error.status === 429) return { field: 'form', message: m.signin_error_throttled() };
		if (error.status === 400) return { field: 'new', message: error.message };
		if (error.code === NETWORK_ERROR) return { field: 'form', message: m.error_unreachable() };
	}
	return { field: 'form', message: m.error_unexpected() };
}

export const MIN_PASSWORD_LENGTH = 10;

/** Mirrors the manager's rule, which counts characters rather than UTF-16 code units. */
export function newPasswordProblem(password: string, confirmation: string): string | null {
	if ([...password].length < MIN_PASSWORD_LENGTH)
		return m.password_error_short({ count: MIN_PASSWORD_LENGTH });
	if (!/\p{Lu}/u.test(password) || !/\p{Nd}/u.test(password)) return m.password_error_composition();
	if (password !== confirmation) return m.password_error_mismatch();
	return null;
}
