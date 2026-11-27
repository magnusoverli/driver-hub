<script lang="ts">
	import { untrack } from 'svelte';
	import { getApi } from '#lib/api/context.js';
	import { ApiError } from '#lib/api/errors.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { m } from '#lib/paraglide/messages.js';
	import type { Role } from '#lib/session/auth-service.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import CopyButton from '#lib/ui/CopyButton.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import RadioGroup from '#lib/ui/RadioGroup.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import { roleOptions } from '#lib/users/roles.js';
	import { createApiToken, tokenNameProblem, type CreatedApiToken } from './tokens';

	type Props = { open: boolean; onCreated: (token: CreatedApiToken) => void };

	let { open = $bindable(false), onCreated }: Props = $props();

	const api = getApi();
	const formId = $props.id();
	let name = $state('');
	let role = $state<Role>('viewer');
	let attempted = $state(false);
	let busy = $state(false);
	let taken = $state<string | null>(null);
	let formError = $state<string | null>(null);
	/** Shown once, then gone: Hub keeps only its hash. */
	let created = $state<CreatedApiToken | null>(null);

	const nameError = $derived(taken ?? (attempted ? tokenNameProblem(name) : null));

	$effect(() => {
		if (open) {
			untrack(() => {
				name = '';
				role = 'viewer';
				attempted = busy = false;
				taken = formError = created = null;
			});
		}
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		taken = formError = null;
		if (tokenNameProblem(name)) return;
		busy = true;
		try {
			created = await createApiToken(api, { name: name.trim(), role });
			onCreated(created);
		} catch (error) {
			if (error instanceof ApiError && error.code === 'token_name_taken') {
				taken = m.api_tokens_error_name_taken();
			} else formError = errorMessage(error);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog
	bind:open
	title={created ? m.api_tokens_created_title() : m.api_tokens_create_title()}
	description={created ? undefined : m.api_tokens_create_description()}
	dismissible={!created}
	width="md"
>
	{#if created}
		<div class="created">
			<Callout tone="warn">{m.api_tokens_created_body()}</Callout>
			<div class="secret">
				<span class="label" id="{formId}-token">{m.api_tokens_token({ name: created.name })}</span>
				<div class="value">
					<code aria-labelledby="{formId}-token">{created.token}</code>
					<CopyButton value={created.token} label={m.api_tokens_copy()} />
				</div>
			</div>
		</div>
	{:else}
		<form id={formId} class="form" onsubmit={submit} novalidate>
			{#if formError}<Callout tone="fail" live>{formError}</Callout>{/if}
			<TextField
				label={m.api_tokens_name()}
				bind:value={name}
				autocomplete="off"
				hint={m.api_tokens_name_hint()}
				error={nameError}
				oninput={() => (taken = null)}
			/>
			<RadioGroup legend={m.api_tokens_role()} options={roleOptions()} bind:value={role} />
		</form>
	{/if}
	{#snippet footer()}
		{#if created}
			<Button variant="primary" onclick={() => (open = false)}>{m.api_tokens_done()}</Button>
		{:else}
			<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
			<Button variant="primary" type="submit" form={formId} {busy}>
				{m.api_tokens_create_submit()}
			</Button>
		{/if}
	{/snippet}
</Dialog>

<style>
	.form,
	.created {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.secret {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.label {
		font-weight: var(--weight-semibold);
	}

	.value {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: var(--sunken);
	}

	code {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
</style>
