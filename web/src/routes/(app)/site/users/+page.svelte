<script lang="ts">
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { getApi } from '#lib/api/context.js';
	import { ApiError } from '#lib/api/errors.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { m } from '#lib/paraglide/messages.js';
	import { roleLabel } from '#lib/shell/role-labels.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import Table from '#lib/ui/Table.svelte';
	import {
		deleteAccount,
		removesLastAdmin,
		sortAccounts,
		userKeys,
		usersQuery,
		type Account
	} from '#lib/users/accounts.js';
	import CreateUserDialog from '#lib/users/CreateUserDialog.svelte';
	import EditUserDialog from '#lib/users/EditUserDialog.svelte';

	const api = getApi();
	const session = getSession();
	const queryClient = useQueryClient();
	const users = createQuery(() => usersQuery(api));
	const accounts = $derived(sortAccounts(users.data ?? []));

	let createOpen = $state(false);
	let editOpen = $state(false);
	let editing = $state<Account | null>(null);
	let notice = $state<string | null>(null);

	function edit(account: Account) {
		editing = account;
		editOpen = true;
	}

	let deleting = $state<Account | null>(null);
	let deleteOpen = $state(false);
	let deleteBusy = $state(false);
	let deleteProblem = $state<string | null>(null);
	const deletesLastAdmin = $derived(
		deleting ? removesLastAdmin(users.data ?? [], deleting.username, { enabled: false }) : false
	);

	function startDelete(account: Account) {
		deleting = account;
		deleteProblem = null;
		deleteOpen = true;
	}

	async function confirmDelete() {
		if (!deleting) return;
		deleteBusy = true;
		deleteProblem = null;
		try {
			await deleteAccount(api, deleting.username);
			notice = m.users_notice_deleted({ username: deleting.username });
			deleteOpen = false;
			void queryClient.invalidateQueries({ queryKey: userKeys.all });
		} catch (error) {
			deleteProblem =
				error instanceof ApiError && error.code === 'last_admin'
					? m.users_error_last_admin()
					: errorMessage(error);
		} finally {
			deleteBusy = false;
		}
	}

	function created(account: Account) {
		notice = m.users_notice_created({ username: account.username });
		void queryClient.invalidateQueries({ queryKey: userKeys.all });
	}

	function saved(account: Account) {
		notice = m.users_notice_saved({ username: account.username });
		void queryClient.invalidateQueries({ queryKey: userKeys.all });
	}
</script>

<PageHeader title={m.nav_users()} description={m.users_description()}>
	{#snippet actions()}
		<Button variant="primary" icon={UserPlus} onclick={() => (createOpen = true)}>
			{m.users_create_action()}
		</Button>
	{/snippet}
</PageHeader>

{#if notice}<Callout title={notice} live />{/if}

{#if users.error}
	<Callout tone="fail" title={m.users_error_title()} live>{users.error.message}</Callout>
{:else if !users.data}
	<Card><Loading label={m.users_loading()} /></Card>
{:else}
	<Card flush>
		<Table label={m.users_table_label()}>
			<thead>
				<tr>
					<th scope="col">{m.users_username()}</th>
					<th scope="col">{m.users_role()}</th>
					<th scope="col">{m.users_column_sign_in()}</th>
					<th scope="col"><span class="visually-hidden">{m.users_column_actions()}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each accounts as account (account.username)}
					{@const self = account.username === session.operator?.username}
					<tr>
						<td>
							<span class="username">
								<span class="name">{account.username}</span>
								{#if self}<Badge tone="accent">{m.users_you()}</Badge>{/if}
							</span>
						</td>
						<td>{roleLabel(account.role)}</td>
						<td>
							{#if account.enabled}
								{m.users_sign_in_allowed()}
							{:else}
								<Badge tone="warn">{m.users_sign_in_disabled()}</Badge>
							{/if}
						</td>
						<td class="actions">
							<span class="row-actions">
								<Button
									size="sm"
									onclick={() => edit(account)}
									aria-label={m.users_edit_action_label({ username: account.username })}
								>
									{m.users_edit_action()}
								</Button>
								{#if !self}
									<IconButton
										size="sm"
										icon={Trash2}
										label={m.users_delete_label({ username: account.username })}
										onclick={() => startDelete(account)}
									/>
								{/if}
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	</Card>
	<p class="footnote">{m.users_footnote()}</p>
{/if}

<CreateUserDialog bind:open={createOpen} onCreated={created} />
{#if editing}
	<EditUserDialog
		bind:open={editOpen}
		account={editing}
		accounts={users.data ?? []}
		self={editing.username === session.operator?.username}
		onSaved={saved}
	/>
{/if}

{#if deleting}
	<ConfirmDialog
		bind:open={deleteOpen}
		title={m.users_delete_title({ username: deleting.username })}
		confirmLabel={m.users_delete_confirm()}
		phrase={deleting.username}
		blocked={deletesLastAdmin}
		busy={deleteBusy}
		problem={deleteProblem}
		onConfirm={confirmDelete}
	>
		{#if deletesLastAdmin}
			<Callout tone="warn">{m.users_error_last_admin()}</Callout>
		{:else}
			<p>{m.users_delete_body()}</p>
		{/if}
	</ConfirmDialog>
{/if}

<style>
	.username {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.name {
		font-weight: var(--weight-semibold);
	}

	.actions {
		text-align: right;
	}

	.row-actions {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.footnote {
		margin-top: calc(-1 * var(--space-2));
		color: var(--text-3);
		font-size: var(--text-sm);
	}
</style>
