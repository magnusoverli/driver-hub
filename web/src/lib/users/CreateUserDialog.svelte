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
	import Dialog from '#lib/ui/Dialog.svelte';
	import RadioGroup from '#lib/ui/RadioGroup.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import { createAccount, normalizeUsername, usernameProblem, type Account } from './accounts';
	import { roleOptions } from './roles';

	type Props = { open: boolean; onCreated: (account: Account) => void };

	let { open = $bindable(false), onCreated }: Props = $props();

	const api = getApi();
	const formId = $props.id();
	let username = $state('');
	let role = $state<Role>('viewer');
	let password = $state('');
	let confirmation = $state('');
	let attempted = $state(false);
	let busy = $state(false);
	let taken = $state<string | null>(null);
	let passwordRefused = $state<string | null>(null);
	let formError = $state<string | null>(null);

	const usernameError = $derived(taken ?? (attempted ? usernameProblem(username) : null));
	const passwordError = $derived(
		passwordRefused ?? (attempted ? newPasswordProblem(password, confirmation) : null)
	);

	$effect(() => {
		if (open) {
			untrack(() => {
				username = password = confirmation = '';
				role = 'viewer';
				attempted = busy = false;
				taken = passwordRefused = formError = null;
			});
		}
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		taken = passwordRefused = formError = null;
		if (usernameProblem(username) || newPasswordProblem(password, confirmation)) return;
		busy = true;
		try {
			const account = await createAccount(api, {
				username: normalizeUsername(username),
				role,
				password
			});
			open = false;
			onCreated(account);
		} catch (error) {
			if (error instanceof ApiError && error.status === 409) taken = m.users_error_taken();
			else if (error instanceof ApiError && /password/i.test(error.message)) {
				passwordRefused = error.message;
			} else formError = errorMessage(error);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog bind:open title={m.users_create_title()} description={m.users_create_description()}>
	<form id={formId} class="form" onsubmit={submit} novalidate>
		{#if formError}<Callout tone="fail" live>{formError}</Callout>{/if}
		<TextField
			label={m.users_username()}
			bind:value={username}
			autocomplete="off"
			autocapitalize="none"
			spellcheck={false}
			hint={m.users_username_hint()}
			error={usernameError}
			oninput={() => (taken = null)}
		/>
		<RadioGroup legend={m.users_role()} options={roleOptions()} bind:value={role} />
		<TextField
			label={m.users_password()}
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
		<p class="note">{m.users_create_note()}</p>
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
		<Button variant="primary" type="submit" form={formId} {busy}>{m.users_create_submit()}</Button>
	{/snippet}
</Dialog>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.note {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
