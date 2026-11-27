import { unwrap, type ApiClient } from '#lib/api/client.js';
import { ApiError, NETWORK_ERROR } from '#lib/api/errors.js';
import { errorMessage } from '#lib/api/messages.js';
import type { ResponseBody, Schema } from '#lib/api/types.js';
import { m } from '#lib/paraglide/messages.js';
import type { PlacementFailure } from './queries';

export type LifecycleAction = 'start' | 'stop' | 'update' | 'rollback';
export type Preview = Schema<'Preview'>;
export type Submission = Schema<'Submission'>;

/** What the manager accepted, for the page to report. */
export interface AppliedChange {
	action: LifecycleAction;
	submission: Submission;
	/** The driver version the deployment now asks for. */
	version: string;
}

export interface ActionInput {
	nodeId: string;
	/** The revision the operator reviewed. A change since then is refused, not overwritten. */
	revision: number;
	/** Update only: the retained version to switch to. */
	version?: string;
	/** Update only: replacement settings; the current ones are kept when omitted. */
	settings?: NonNullable<Schema<'Stage'>['settings']>;
	/** Start only: confirms that the external driver this deployment replaces is stopped. */
	originalStopped?: boolean;
}

function send(api: ApiClient, action: LifecycleAction, input: ActionInput, dryRun: boolean) {
	const params = {
		path: { nodeId: input.nodeId },
		query: dryRun ? { dryRun: true } : undefined
	};
	const { revision } = input;
	switch (action) {
		case 'start':
			return unwrap(
				api.POST('/deployments/{nodeId}/start', {
					params,
					body: input.originalStopped ? { revision, originalStopped: true } : { revision }
				})
			);
		case 'stop':
			return unwrap(api.POST('/deployments/{nodeId}/stop', { params, body: { revision } }));
		case 'update':
			if (!input.version) throw new Error('An update needs a target version');
			return unwrap(
				api.POST('/deployments/{nodeId}/update', {
					params,
					body: input.settings
						? { revision, version: input.version, settings: input.settings }
						: { revision, version: input.version }
				})
			);
		case 'rollback':
			return unwrap(api.POST('/deployments/{nodeId}/rollback', { params, body: { revision } }));
	}
}

function isPreview(result: Preview | Submission): result is Preview {
	return 'preview' in result && result.preview;
}

/** Asks Nomad for a plan without publishing an image or changing the job. Viewers may do this. */
export async function previewAction(
	api: ApiClient,
	action: LifecycleAction,
	input: ActionInput
): Promise<Preview> {
	const result = await send(api, action, input, true);
	if (!isPreview(result)) throw new Error('The manager did not return a preview');
	return result;
}

/** Submits the change. Success means Nomad accepted the desired state, not that it is healthy. */
export async function applyAction(
	api: ApiClient,
	action: LifecycleAction,
	input: ActionInput
): Promise<Submission> {
	const result = await send(api, action, input, false);
	if (isPreview(result)) throw new Error('The manager returned a preview instead of submitting');
	return result;
}

export type SettingsError = { field: string; code: string };

export type ActionProblem =
	/** The deployment changed after the operator reviewed it. */
	| { kind: 'conflict'; message: string }
	| { kind: 'placement'; message: string; failures: PlacementFailure[] }
	/** A migration start needs confirmation that the original driver is stopped. */
	| { kind: 'original'; message: string }
	/** The target release needs settings that this deployment does not have. */
	| { kind: 'settings'; message: string; fields: SettingsError[] }
	/** A submission whose outcome is unknown: it may have been applied. */
	| { kind: 'uncertain'; message: string }
	| { kind: 'other'; message: string };

function settingsErrors(details: Record<string, unknown> | undefined): SettingsError[] {
	const fields = details?.fields;
	if (!Array.isArray(fields)) return [];
	return fields.filter(
		(entry): entry is SettingsError =>
			typeof entry === 'object' &&
			entry !== null &&
			typeof (entry as SettingsError).field === 'string' &&
			typeof (entry as SettingsError).code === 'string'
	);
}

function placementFailures(details: Record<string, unknown> | undefined): PlacementFailure[] {
	const failures = details?.placementFailures;
	return Array.isArray(failures) ? (failures as PlacementFailure[]) : [];
}

/**
 * Explains a refused preview or submission. After a submission that got no definite answer the
 * change may have been applied, so the operator is asked to read the current state before trying
 * again rather than to repeat it.
 */
export function actionProblem(error: unknown, stage: 'preview' | 'apply'): ActionProblem {
	if (!(error instanceof ApiError)) return { kind: 'other', message: m.error_unexpected() };
	// 503 is a definite refusal before anything was attempted, such as missing site setup.
	const indefinite = error.code === NETWORK_ERROR || (error.status >= 500 && error.status !== 503);
	if (stage === 'apply' && indefinite) {
		return { kind: 'uncertain', message: m.action_problem_uncertain() };
	}
	switch (error.code) {
		case 'revision_conflict':
			return { kind: 'conflict', message: m.action_problem_conflict() };
		case 'placement_failed':
			return {
				kind: 'placement',
				message: m.action_problem_placement(),
				failures: placementFailures(error.details)
			};
		case 'original_stop_required':
			return { kind: 'original', message: m.action_problem_original() };
		case 'invalid_settings':
			return {
				kind: 'settings',
				message: m.action_problem_configuration(),
				fields: settingsErrors(error.details)
			};
		case 'admin_required':
			return { kind: 'other', message: m.action_problem_forbidden() };
		case NETWORK_ERROR:
			return { kind: 'other', message: m.error_unreachable() };
	}
	if (error.status === 404 && /retained/i.test(error.message)) {
		return { kind: 'other', message: m.action_problem_not_retained() };
	}
	// The manager's own explanation is the most precise one available for anything else; an
	// internal error carries no useful detail.
	return { kind: 'other', message: error.status === 500 ? m.error_unexpected() : error.message };
}

const settingsCodes: Record<string, () => string> = {
	required: m.configuration_error_required,
	wrong_type: m.configuration_error_wrong_type,
	too_short: m.configuration_error_too_short,
	too_long: m.configuration_error_too_long,
	out_of_range: m.configuration_error_out_of_range,
	secret_reference_required: m.configuration_error_secret_reference,
	unknown_input: m.configuration_error_unknown_input,
	site_input_override: m.configuration_error_site_input,
	identity_override: m.configuration_error_identity
};

export function settingsErrorText(code: string): string {
	return settingsCodes[code]?.() ?? code;
}

export type Deletion = ResponseBody<'/deployments/{nodeId}', 'delete'>;

/** Deletes a stopped deployment at the revision the operator reviewed. Cannot be undone. */
export function deleteDeployment(
	api: ApiClient,
	nodeId: string,
	revision: number
): Promise<Deletion> {
	return unwrap(
		api.DELETE('/deployments/{nodeId}', { params: { path: { nodeId }, query: { revision } } })
	);
}

/** Why the manager refused to delete a deployment. */
export function deletionProblem(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === 'revision_conflict') return m.delete_problem_conflict();
		if (error.code === 'deployment_running') return m.delete_problem_running();
		if (error.code === 'shared_writers') return m.delete_problem_shared_writers();
	}
	return errorMessage(error);
}
