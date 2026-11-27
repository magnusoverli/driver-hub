import { queryOptions } from '@tanstack/svelte-query';
import { unwrap, type ApiClient } from '#lib/api/client.js';
import type { RequestBody, Schema } from '#lib/api/types.js';
import { m } from '#lib/paraglide/messages.js';

export type Site = Schema<'Site'>;
export type NomadInput = RequestBody<'/site/nomad', 'put'>;
export type VideoIPathInput = RequestBody<'/site/videoipath', 'put'>;

export const siteKeys = {
	all: ['site'] as const,
	settings: () => [...siteKeys.all, 'settings'] as const
};

export function siteQuery(api: ApiClient) {
	return queryOptions({
		queryKey: siteKeys.settings(),
		queryFn: () => unwrap(api.GET('/site'))
	});
}

export function configureNomad(api: ApiClient, input: NomadInput): Promise<Site> {
	return unwrap(api.PUT('/site/nomad', { body: input }));
}

export function configureVideoIPath(api: ApiClient, input: VideoIPathInput): Promise<Site> {
	return unwrap(api.PUT('/site/videoipath', { body: input }));
}

/** Removes a per-device token from the pool by fingerprint. Revocation stays in VideoIPath. */
export function removeToken(api: ApiClient, fingerprint: string, revision: number): Promise<Site> {
	return unwrap(
		api.DELETE('/site/videoipath/tokens/{fingerprint}', {
			params: { path: { fingerprint }, query: { revision } }
		})
	);
}

function parseEndpoint(value: string): URL | null {
	const trimmed = value.trim();
	if (!trimmed || /[\s\\?#@]/.test(trimmed)) return null;
	const explicit = trimmed.includes('://');
	// A bare IPv6 address needs brackets to become a URL host.
	const host = !explicit && trimmed.split(':').length > 2 ? `[${trimmed}]` : trimmed;
	try {
		return new URL(explicit ? trimmed : `https://${host}`);
	} catch {
		return null;
	}
}

/**
 * The Nomad API origin the manager will use, as it normalizes it: a bare host or IP address
 * means HTTPS on port 4646. Null when the manager would refuse the address.
 */
export function nomadOrigin(value: string): string | null {
	const url = parseEndpoint(value);
	if (!url || !['http:', 'https:'].includes(url.protocol) || url.pathname !== '/') return null;
	const explicit = value.trim().includes('://');
	if (!explicit && !url.port && !value.trim().endsWith(':443')) url.port = '4646';
	return url.origin;
}

/** The driver WebSocket endpoint the manager derives from a VideoIPath address. */
export function videoIPathEndpoint(value: string): string | null {
	const url = parseEndpoint(value);
	if (!url || !['wss:', 'https:'].includes(url.protocol)) return null;
	if (url.pathname !== '/' && url.pathname !== '/x-driver/v1') return null;
	return `wss://${url.host}/x-driver/v1`;
}

const NAMESPACE = /^[a-zA-Z0-9_-]+$/;
const DATACENTER = /^[\w.*-]+$/;

export function namespaceProblem(value: string): string | null {
	return NAMESPACE.test(value.trim()) ? null : m.nomad_error_namespace();
}

/** Datacenters separated by commas or spaces. */
export function parseDatacenters(value: string): string[] {
	return value
		.split(/[\s,]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function datacentersProblem(value: string): string | null {
	const datacenters = parseDatacenters(value);
	if (!datacenters.length) return m.nomad_error_datacenters_required();
	return datacenters.every((dc) => DATACENTER.test(dc)) ? null : m.nomad_error_datacenters();
}

/** Bearer tokens, one per line or separated by spaces; duplicates are entered once. */
export function parseTokens(value: string): string[] {
	return [...new Set(value.split(/\s+/).filter(Boolean))];
}

export function tokenProblem(token: string): string | null {
	if (!token) return m.videoipath_error_token_required();
	if (token.length > 8192) return m.videoipath_error_token_long();
	return null;
}

/** How the saved Nomad ACL token is treated when the connection is saved. */
export type NomadTokenChoice = 'keep' | 'replace' | 'none';

/**
 * The manager keeps a saved token only for the same address and namespace, so a token for one
 * cluster is never sent to another. Elsewhere the operator enters one or chooses none.
 */
export function canKeepNomadToken(site: Site, origin: string | null, namespace: string): boolean {
	return (
		site.nomad.tokenConfigured &&
		origin !== null &&
		origin === site.nomad.address &&
		namespace.trim() === site.nomad.namespace
	);
}

export function nomadInput(
	revision: number,
	form: {
		address: string;
		namespace: string;
		datacenters: string;
		tokenChoice: NomadTokenChoice;
		token: string;
	}
): NomadInput {
	const input: NomadInput = {
		revision,
		address: form.address.trim(),
		namespace: form.namespace.trim(),
		datacenters: parseDatacenters(form.datacenters)
	};
	if (form.tokenChoice === 'replace') input.token = form.token.trim();
	if (form.tokenChoice === 'none') input.token = null;
	return input;
}
