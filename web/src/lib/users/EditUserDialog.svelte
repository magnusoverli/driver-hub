<script lang="ts">
	import { untrack } from 'svelte';
	import { getApi } from '#lib/api/context.js';
	import { ApiError } from '#lib/api/errors.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { m } from '#lib/paraglide/messages.js';
	import type { Role } from '#lib/session/auth-service.js';
	import { MIN_PASSWORD_LENGTH, newPasswordProblem } from '#lib/session/error-messages.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import RadioGroup from '#lib/ui/RadioGroup.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import { accountChanges, removesLastAdmin, updateAccount, type Account } from './accounts';
	import { roleOptions } from './roles';

	type Props = {
		open: boolean;
		account: Account;
		/** Every local account, to keep at least one enabled administrator. */
		accounts: Account[];
		/** Editing the signed-in operator's own account. */
		self: boolean;
		onSaved: (account: Account) => void;
	};

	let { open = $bindable(false), account, accounts, self, onSaved }: Props = $props();

	const api = getApi();
	const formId = $props.id();
	let role = $state<Role>('viewer');
	let enabled = $state(true);
	let setPassword = $state(false);
	let password = $state('');
	let confirmation = $state('');
	let attempted = $state(false);
	let busy = $state(false);
	let formError = $state<string | null>(null);
	let passwordRefused = $state<string | null>(null);

	$effect(() => {
		if (open) {
			untrack(() => {
				role = account.role;
				enabled = account.enabled;
				setPassword = attempted = busy = false;
				password = confirmation = '';
				formError = passwordRefused = null;
			});
		}
	});

	const changes = $derived(
		accountChanges(account, { role, enabled, password: setPassword ? password : undefined })
	);
	const changed = $derived(Object.keys(changes).length > 0 || setPassword);
	const lastAdmin = $derived(removesLastAdmin(accounts, account.username, changes));
	const passwordError = $derived(
		passwordRefused ??
			(attempted && setPassword ? newPasswordProblem(password, confirmation) : null)
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		formError = passwordRefused = null;
		if (lastAdmin || (setPassword && newPasswordProblem(password, confirmation))) return;
		busy = true;
		try {
			const saved = await updateAccount(api, account.username, changes);
			open = false;
			onSaved(saved);
		} catch (error) {
			if (error instanceof ApiError && error.status === 400 && /password/i.test(error.message)) {
				passwordRefused = error.message;
			} else if (error instanceof ApiError && error.status === 409) {
				formError = m.users_error_last_admin();
			} else formError = errorMessage(error);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog
	bind:open
	title={m.users_edit_title({ username: account.username })}
	description={self ? m.users_edit_self_description() : m.users_edit_description()}
>
	<form id={formId} class="form" onsubmit={submit} novalidate>
		{#if formError}<Callout tone="fail" live>{formError}</Callout>{/if}
		<RadioGroup legend={m.users_role()} options={roleOptions()} bind:value={role} />
		<Checkbox bind:checked={enabled} hint={m.users_enabled_hint()}>
			{m.users_enabled()}
		</Checkbox>
		<Checkbox bind:checked={setPassword}>{m.users_set_password()}</Checkbox>
		{#if setPassword}
			<TextField
				label={m.users_new_password()}
				type="password"
				autocomplete="new-password"
				bind:value={password}
				hint={m.password_rule({ count: MIN_PASSWORD_LENGTH })}
				error={passwordError}
				oninput={() => (passwordRefused = null)}
			/>
			<TextField
				label={m.users_password_confirm()}
				type="password"
				autocomplete="new-password"
				bind:value={confirmation}
			/>
		{/if}
		{#if lastAdmin}
			<Callout tone="warn" live>{m.users_error_last_admin()}</Callout>
		{:else if changed && self}
			<Callout tone="warn">{m.users_edit_self_warning()}</Callout>
		{/if}
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
		<Button variant="primary" type="submit" form={formId} {busy} disabled={!changed || lastAdmin}>
			{m.users_edit_submit()}
		</Button>
	{/snippet}
</Dialog>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
