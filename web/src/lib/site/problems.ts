import { ApiError } from '#lib/api/errors.js';
import { errorMessage } from '#lib/api/messages.js';
import { m } from '#lib/paraglide/messages.js';

export type SiteProblem = { kind: 'conflict' | 'other'; message: string };

/** Why the manager refused to save a site setting. */
export function siteProblem(error: unknown): SiteProblem {
	if (error instanceof ApiError) {
		if (error.code === 'revision_conflict') {
			return { kind: 'conflict', message: m.site_error_conflict() };
		}
		if (error.code === 'nomad_not_ready')
			return { kind: 'other', message: m.nomad_error_no_leader() };
		if (error.status === 502) {
			return { kind: 'other', message: m.nomad_error_unreachable({ detail: error.message }) };
		}
	}
	return { kind: 'other', message: errorMessage(error) };
}
