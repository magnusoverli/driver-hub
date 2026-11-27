<script lang="ts">
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { getApi } from '#lib/api/context.js';
	import { errorMessage } from '#lib/api/messages.js';
	import CreateTokenDialog from '#lib/api-tokens/CreateTokenDialog.svelte';
	import {
		apiTokenKeys,
		apiTokensQuery,
		deleteApiToken,
		sortTokens,
		type ApiToken
	} from '#lib/api-tokens/tokens.js';
	import { m } from '#lib/paraglide/messages.js';
	import { roleLabel } from '#lib/shell/role-labels.js';
	import { environmentQuery } from '#lib/site/settings.js';
	import { formatTimestamp } from '#lib/time/format.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import Table from '#lib/ui/Table.svelte';

	const api = getApi();
	const queryClient = useQueryClient();
	const tokens = createQuery(() => apiTokensQuery(api));
	const environment = createQuery(() => environmentQuery(api));
	const sorted = $derived(sortTokens(tokens.data ?? []));
	const emergencyToken = $derived(
		environment.data?.some(
			(setting) => setting.name === 'DRIVER_HUB_ADMIN_TOKEN' && setting.source === 'environment'
		) ?? false
	);

	let createOpen = $state(false);
	let notice = $state<string | null>(null);

	let deleting = $state<ApiToken | null>(null);
	let deleteOpen = $state(false);
	let deleteBusy = $state(false);
	let deleteProblem = $state<string | null>(null);

	function startDelete(token: ApiToken) {
		deleting = token;
		deleteProblem = null;
		deleteOpen = true;
	}

	async function confirmDelete() {
		if (!deleting) return;
		deleteBusy = true;
		deleteProblem = null;
		try {
			await deleteApiToken(api, deleting.id);
			notice = m.api_tokens_notice_deleted({ name: deleting.name });
			deleteOpen = false;
			void queryClient.invalidateQueries({ queryKey: apiTokenKeys.all });
		} catch (error) {
			deleteProblem = errorMessage(error);
		} finally {
			deleteBusy = false;
		}
	}

	function created(token: ApiToken) {
		notice = m.api_tokens_notice_created({ name: token.name });
		void queryClient.invalidateQueries({ queryKey: apiTokenKeys.all });
	}
</script>

<PageHeader title={m.nav_api_tokens()} description={m.api_tokens_description()}>
	{#snippet actions()}
		<Button variant="primary" icon={Plus} onclick={() => (createOpen = true)}>
			{m.api_tokens_create_action()}
		</Button>
	{/snippet}
</PageHeader>

{#if notice}<Callout title={notice} live />{/if}
{#if emergencyToken}
	<Callout tone="warn" title={m.api_tokens_emergency_title()}>
		{m.api_tokens_emergency_body()}
	</Callout>
{/if}

{#if tokens.error}
	<Callout tone="fail" title={m.api_tokens_error_title()} live>{tokens.error.message}</Callout>
{:else if !tokens.data}
	<Card><Loading label={m.api_tokens_loading()} /></Card>
{:else if !sorted.length}
	<Card>
		<EmptyState icon={KeyRound} title={m.api_tokens_empty_title()}>
			{m.api_tokens_empty_body()}
		</EmptyState>
	</Card>
{:else}
	<Card flush>
		<Table label={m.api_tokens_table_label()}>
			<thead>
				<tr>
					<th scope="col">{m.api_tokens_name()}</th>
					<th scope="col">{m.api_tokens_role()}</th>
					<th scope="col">{m.api_tokens_created()}</th>
					<th scope="col"><span class="visually-hidden">{m.api_tokens_column_actions()}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each sorted as token (token.id)}
					<tr>
						<td><span class="name">{token.name}</span></td>
						<td>{roleLabel(token.role)}</td>
						<td>
							{token.createdBy
								? m.api_tokens_created_by({
										time: formatTimestamp(token.createdAt),
										username: token.createdBy
									})
								: formatTimestamp(token.createdAt)}
						</td>
						<td class="actions">
							<IconButton
								size="sm"
								icon={Trash2}
								label={m.api_tokens_delete_label({ name: token.name })}
								onclick={() => startDelete(token)}
							/>
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	</Card>
{/if}
<p class="footnote">{m.api_tokens_footnote()}</p>

<CreateTokenDialog bind:open={createOpen} onCreated={created} />

{#if deleting}
	<ConfirmDialog
		bind:open={deleteOpen}
		title={m.api_tokens_delete_title({ name: deleting.name })}
		confirmLabel={m.api_tokens_delete_confirm()}
		busy={deleteBusy}
		problem={deleteProblem}
		onConfirm={confirmDelete}
	>
		<p>{m.api_tokens_delete_body()}</p>
	</ConfirmDialog>
{/if}

<style>
	.name {
		font-weight: var(--weight-semibold);
	}

	.actions {
		text-align: right;
	}

	.footnote {
		margin-top: calc(-1 * var(--space-2));
		color: var(--text-3);
		font-size: var(--text-sm);
	}
</style>
