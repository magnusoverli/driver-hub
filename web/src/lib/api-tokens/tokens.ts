import { queryOptions } from '@tanstack/svelte-query';
import { unwrap, type ApiClient } from '#lib/api/client.js';
import type { Schema } from '#lib/api/types.js';
import { m } from '#lib/paraglide/messages.js';
import type { Role } from '#lib/session/auth-service.js';

export type ApiToken = Schema<'ApiToken'>;
/** A token as returned once at creation, with its secret value. */
export type CreatedApiToken = ApiToken & { token: string };

export const apiTokenKeys = {
	all: ['api-tokens'] as const,
	list: () => [...apiTokenKeys.all, 'list'] as const
};

export function apiTokensQuery(api: ApiClient) {
	return queryOptions({
		queryKey: apiTokenKeys.list(),
		queryFn: async () => (await unwrap(api.GET('/api-tokens'))).tokens
	});
}

export function createApiToken(
	api: ApiClient,
	input: { name: string; role: Role }
): Promise<CreatedApiToken> {
	return unwrap(api.POST('/api-tokens', { body: input }));
}

export function deleteApiToken(api: ApiClient, id: string) {
	return unwrap(api.DELETE('/api-tokens/{tokenId}', { params: { path: { tokenId: id } } }));
}

/** Mirrors the manager: 1 to 80 characters, compared without leading or trailing spaces. */
export function tokenNameProblem(value: string): string | null {
	const name = value.trim();
	if (!name) return m.api_tokens_error_name_required();
	if ([...name].length > 80) return m.api_tokens_error_name_long();
	return null;
}

/** Newest first, so a token just created is at the top. */
export function sortTokens(tokens: readonly ApiToken[]): ApiToken[] {
	return [...tokens].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
