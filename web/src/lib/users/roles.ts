import { m } from '#lib/paraglide/messages.js';
import type { Role } from '#lib/session/auth-service.js';

/** The two Hub roles, described by what they allow. */
export function roleOptions(): { value: Role; label: string; description: string }[] {
	return [
		{ value: 'viewer', label: m.role_viewer(), description: m.users_role_viewer_description() },
		{ value: 'admin', label: m.role_admin(), description: m.users_role_admin_description() }
	];
}
