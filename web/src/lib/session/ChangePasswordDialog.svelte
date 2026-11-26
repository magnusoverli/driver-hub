<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import { MIN_PASSWORD_LENGTH, newPasswordProblem, passwordChangeProblem } from './error-messages';
	import { getSession } from './session.svelte';

	let { open = $bindable(false) }: { open: boolean } = $props();

	const session = getSession();
	const formId = $props.id();
	let current = $state('');
	let next = $state('');
	let confirmation = $state('');
	let busy = $state(false);
	let attempted = $state(false);
	let currentError = $state<string | null>(null);
	let serverNewError = $state<string | null>(null);
	let formError = $state<string | null>(null);

	// Validation is shown after the first attempt, then follows the input as it changes.
	const newError = $derived(
		serverNewError ?? (attempted ? newPasswordProblem(next, confirmation) : null)
	);

	$effect(() => {
		if (!open) reset();
	});

	function reset() {
		current = next = confirmation = '';
		attempted = busy = false;
		currentError = serverNewError = formError = null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		serverNewError = currentError = formError = null;
		if (!current) currentError = m.password_error_current_required();
		if (currentError || newPasswordProblem(next, confirmation)) return;
		busy = true;
		try {
			await session.changePassword(current, next);
			open = false;
		} catch (error) {
			const problem = passwordChangeProblem(error);
			if (problem.field === 'current') currentError = problem.message;
			else if (problem.field === 'new') serverNewError = problem.message;
			else formError = problem.message;
		} finally {
			busy = false;
		}
	}
</script>

<Dialog bind:open title={m.password_title()} description={m.password_description()}>
	<form id={formId} class="form" onsubmit={submit} novalidate>
		{#if formError}<Callout tone="fail" live>{formError}</Callout>{/if}
		<TextField
			label={m.password_current()}
			type="password"
			autocomplete="current-password"
			bind:value={current}
			error={currentError}
			oninput={() => (currentError = null)}
		/>
		<TextField
			label={m.password_new()}
			type="password"
			autocomplete="new-password"
			bind:value={next}
			hint={m.password_rule({ count: MIN_PASSWORD_LENGTH })}
			error={newError}
			oninput={() => (serverNewError = null)}
		/>
		<TextField
			label={m.password_confirm()}
			type="password"
			autocomplete="new-password"
			bind:value={confirmation}
		/>
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
		<Button variant="primary" type="submit" form={formId} {busy}>{m.password_submit()}</Button>
	{/snippet}
</Dialog>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
