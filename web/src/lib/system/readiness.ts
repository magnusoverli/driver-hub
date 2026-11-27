import { ApiError } from '#lib/api/errors.js';
import { m } from '#lib/paraglide/messages.js';
import type { Capabilities, NomadConnection } from './queries';

export type ReadinessState =
	/** Configured and, where Hub can check it, working. */
	| 'ready'
	/** Deployments cannot work until someone acts. */
	| 'attention'
	/** Optional and switched off. */
	| 'optional'
	/** Not known yet. */
	| 'checking';

export interface ReadinessItem {
	id: 'nomad' | 'videoipath' | 'images' | 'builds';
	label: string;
	state: ReadinessState;
	detail: string;
	/** Where an administrator changes it in Hub. */
	settingsRoute?:
		'/(app)/settings/nomad' | '/(app)/settings/videoipath' | '/(app)/settings/manager';
}

export interface ReadinessInput {
	capabilities: Capabilities | undefined;
	nomad: NomadConnection | undefined;
	nomadError: unknown;
}

function nomadItem({ nomad, nomadError }: ReadinessInput): ReadinessItem {
	const base = {
		id: 'nomad',
		label: m.readiness_nomad(),
		settingsRoute: '/(app)/settings/nomad'
	} as const;
	if (nomadError) {
		const detail = nomadError instanceof ApiError ? nomadError.message : m.error_unexpected();
		return { ...base, state: 'attention', detail: m.readiness_nomad_unreachable({ detail }) };
	}
	switch (nomad?.state) {
		case 'connected':
			return {
				...base,
				state: 'ready',
				detail: m.readiness_nomad_connected({ namespace: nomad.namespace })
			};
		case 'no_leader':
			return { ...base, state: 'attention', detail: m.readiness_nomad_no_leader() };
		case 'not_configured':
			return { ...base, state: 'attention', detail: m.readiness_nomad_not_configured() };
		default:
			return { ...base, state: 'checking', detail: m.readiness_checking() };
	}
}

/**
 * What the site needs before drivers can be deployed, in the order an administrator sets it up.
 * Only reports what the manager states; a configured target is not claimed to be reachable.
 */
export function siteReadiness(input: ReadinessInput): ReadinessItem[] {
	const { capabilities } = input;
	const checking = { state: 'checking' as const, detail: m.readiness_checking() };
	return [
		nomadItem(input),
		{
			id: 'videoipath',
			label: m.readiness_videoipath(),
			settingsRoute: '/(app)/settings/videoipath',
			...(!capabilities
				? checking
				: capabilities.videoIPathConfigured
					? { state: 'ready', detail: m.readiness_videoipath_configured() }
					: { state: 'attention', detail: m.readiness_videoipath_missing() })
		},
		{
			id: 'images',
			label: m.readiness_images(),
			settingsRoute: '/(app)/settings/nomad',
			...(!capabilities
				? checking
				: capabilities.imageHostConfigured
					? { state: 'ready', detail: m.readiness_images_configured() }
					: { state: 'attention', detail: m.readiness_images_missing() })
		},
		{
			id: 'builds',
			label: m.readiness_builds(),
			settingsRoute: '/(app)/settings/manager',
			...(!capabilities
				? checking
				: capabilities.buildsEnabled
					? { state: 'ready', detail: m.readiness_builds_enabled() }
					: { state: 'optional', detail: m.readiness_builds_disabled() })
		}
	];
}
