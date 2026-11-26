import { m } from '#lib/paraglide/messages.js';
import type { Role } from '#lib/session/auth-service.js';

const labels: Record<Role, () => string> = { admin: m.role_admin, viewer: m.role_viewer };

export function roleLabel(role: Role): string {
	return labels[role]();
}
