import { describe, expect, it } from 'vitest';
import { ApiError } from '#lib/api/errors.js';
import { m } from '#lib/paraglide/messages.js';
import { newPasswordProblem, passwordChangeProblem, signInErrorMessage } from './error-messages.js';

describe('sign-in errors', () => {
	it('gives one answer for every credential problem', () => {
		const refused = new ApiError(401, 'invalid_credentials', 'Invalid username or password');
		expect(signInErrorMessage(refused)).toBe(m.signin_error_invalid());
	});

	it('explains throttling, unreachable managers and anything else', () => {
		expect(signInErrorMessage(new ApiError(429, 'busy', 'Too many'))).toBe(
			m.signin_error_throttled()
		);
		expect(signInErrorMessage(ApiError.network(null))).toBe(m.error_unreachable());
		expect(signInErrorMessage(new ApiError(500, 'internal_error', 'x'))).toBe(m.error_unexpected());
		expect(signInErrorMessage(new Error('boom'))).toBe(m.error_unexpected());
	});
});

describe('password changes', () => {
	it('counts characters like the manager, not UTF-16 code units', () => {
		const elevenEmoji = '🔑'.repeat(11);
		expect(elevenEmoji.length).toBe(22);
		expect(newPasswordProblem(elevenEmoji, elevenEmoji)).toBe(
			m.password_error_short({ count: 12 })
		);
		expect(newPasswordProblem('🔑'.repeat(12), '🔑'.repeat(12))).toBeNull();
	});

	it('requires the confirmation to match', () => {
		expect(newPasswordProblem('long-enough-pass', 'long-enough-pas')).toBe(
			m.password_error_mismatch()
		);
	});

	it('attributes backend refusals to the field that caused them', () => {
		expect(passwordChangeProblem(new ApiError(401, 'invalid_credentials', 'x')).field).toBe(
			'current'
		);
		expect(passwordChangeProblem(new ApiError(400, 'bad_request', 'Passwords must…'))).toEqual({
			field: 'new',
			message: 'Passwords must…'
		});
		expect(passwordChangeProblem(new ApiError(429, 'busy', 'x')).field).toBe('form');
		expect(passwordChangeProblem(ApiError.network(null)).message).toBe(m.error_unreachable());
	});
});
