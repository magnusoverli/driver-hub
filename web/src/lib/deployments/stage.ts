import { unwrap, type ApiClient } from '#lib/api/client.js';
import { ApiError, NETWORK_ERROR } from '#lib/api/errors.js';
import { errorMessage, fieldErrors } from '#lib/api/messages.js';
import type { Schema } from '#lib/api/types.js';
import { m } from '#lib/paraglide/messages.js';
import type { DeployForm, Settings } from './settings-form';

export type StageBody = Schema<'Stage'>;
type Release = { driverId: string; version: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The node ID of an external driver being replaced: a lowercase, non-nil UUID. */
export function nodeIdProblem(value: string): string | null {
	const id = value.trim();
	if (!id) return m.stage_error_node_id_required();
	if (!UUID.test(id) || /^[0-]+$/.test(id)) return m.stage_error_node_id_format();
	return null;
}

/** The form a retained release declares, resolved for this site and device. */
export function deployForm(
	api: ApiClient,
	release: Release,
	input: { inheritSite?: boolean; nodeId?: string; settings?: Settings }
): Promise<DeployForm> {
	return unwrap(
		api.POST('/retained/{driverId}/{version}/deploy-form', {
			params: { path: release },
			body: input
		})
	);
}

/**
 * Stages a stopped deployment, or plans it with `dryRun`. A new device sends its chosen node ID
 * as the request key, so a retry after a lost answer finds the same deployment instead of
 * creating another. A replacement names the existing node ID instead, and must not send a key.
 */
export async function stageDeployment(
	api: ApiClient,
	body: StageBody,
	key: string | undefined,
	dryRun: boolean
) {
	const result = await unwrap(
		api.POST('/deployments', {
			params: {
				query: dryRun ? { dryRun: true } : undefined,
				header: body.nodeId === undefined && key ? { 'Idempotency-Key': key } : undefined
			},
			body
		})
	);
	if (dryRun !== 'preview' in result) throw new Error('The manager answered with the wrong kind');
	return result;
}

export type StageProblem =
	| { kind: 'settings'; message: string; fields: { field: string; code: string }[] }
	/** The site has no unused VideoIPath token for another device. */
	| { kind: 'pool'; message: string }
	| { kind: 'exists'; message: string }
	/** The outcome is unknown; repeating the same request is safe. */
	| { kind: 'uncertain'; message: string }
	| { kind: 'other'; message: string };

export function stageProblem(error: unknown, applying: boolean): StageProblem {
	if (error instanceof ApiError) {
		if (
			applying &&
			(error.code === NETWORK_ERROR || (error.status >= 500 && error.status !== 503))
		) {
			return { kind: 'uncertain', message: m.stage_problem_uncertain() };
		}
		switch (error.code) {
			case 'invalid_settings':
				return {
					kind: 'settings',
					message: m.action_problem_settings(),
					fields: fieldErrors(error)
				};
			case 'driver_token_pool_empty':
				return { kind: 'pool', message: m.stage_problem_pool() };
			case 'deployment_exists':
				return { kind: 'exists', message: m.stage_problem_exists() };
			case 'site_changed':
				return { kind: 'other', message: m.stage_problem_site_changed() };
			case 'site_input_override':
				return { kind: 'other', message: m.stage_problem_site_input() };
		}
		if (error.status === 404) return { kind: 'other', message: m.action_problem_not_retained() };
	}
	return { kind: 'other', message: errorMessage(error) };
}
