import { unwrap, type ApiClient } from '#lib/api/client.js';
import { ApiError } from '#lib/api/errors.js';
import type { components } from '#lib/api/schema.js';

export type Operator = components['schemas']['Operator'];
export type Role = Operator['role'];

/** What the session state needs from the backend; implemented over HTTP or faked in tests. */
export interface AuthService {
	/** The signed-in operator, or null when there is no valid session. */
	current: () => Promise<Operator | null>;
	signIn: (username: string, password: string) => Promise<Operator>;
	signOut: () => Promise<void>;
	/** Succeeds by ending every session of this operator, including the current one. */
	changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

export function httpAuthService(api: ApiClient): AuthService {
	return {
		async current() {
			try {
				return await unwrap(api.GET('/auth/session'));
			} catch (error) {
				if (error instanceof ApiError && error.status === 401) return null;
				throw error;
			}
		},
		signIn: (username, password) =>
			unwrap(
				api.POST('/auth/login', {
					body: { username, password },
					params: { header: { 'X-Driver-Hub-Request': '1' } }
				})
			),
		async signOut() {
			await unwrap(
				api.POST('/auth/logout', { params: { header: { 'X-Driver-Hub-Request': '1' } } })
			);
		},
		async changePassword(currentPassword, newPassword) {
			await unwrap(
				api.POST('/auth/password', {
					body: { currentPassword, newPassword },
					params: { header: { 'X-Driver-Hub-Request': '1' } }
				})
			);
		}
	};
}
