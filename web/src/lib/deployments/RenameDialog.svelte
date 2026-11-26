<script lang="ts">
	import { untrack } from 'svelte';
	import { unwrap } from '#lib/api/client.js';
	import { getApi } from '#lib/api/context.js';
	import { ApiError, NETWORK_ERROR } from '#lib/api/errors.js';
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import { labelProblem, MAX_LABEL_LENGTH } from './view';

	type Props = {
		open: boolean;
		nodeId: string;
		label: string | null;
		onRenamed: (label: string | null) => void;
	};

	let { open = $bindable(false), nodeId, label, onRenamed }: Props = $props();

	const api = getApi();
	const formId = $props.id();
	let value = $state('');
	let attempted = $state(false);
	let busy = $state<'save' | 'remove' | null>(null);
	/** The manager refused the name itself. */
	let rejected = $state<string | null>(null);
	/** Anything else that went wrong. */
	let formError = $state<string | null>(null);

	const fieldError = $derived(rejected ?? (attempted ? labelProblem(value) : null));

	$effect(() => {
		if (open) {
			untrack(() => {
				value = label ?? '';
				attempted = false;
				busy = rejected = formError = null;
			});
		}
	});

	async function send(next: string | null) {
		rejected = formError = null;
		busy = next === null ? 'remove' : 'save';
		try {
			const result = await unwrap(
				api.PUT('/deployments/{nodeId}/label', {
					params: { path: { nodeId } },
					body: { label: next }
				})
			);
			open = false;
			onRenamed(result.label);
		} catch (error) {
			if (error instanceof ApiError && error.code === 'invalid_label') rejected = error.message;
			else if (error instanceof ApiError && error.code === NETWORK_ERROR) {
				formError = m.error_unreachable();
			} else if (error instanceof ApiError && error.status !== 500) formError = error.message;
			else formError = m.error_unexpected();
		} finally {
			busy = null;
		}
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		if (labelProblem(value)) return;
		void send(value.trim());
	}
</script>

<Dialog bind:open title={m.rename_title()} description={m.rename_description()}>
	<form id={formId} class="form" onsubmit={save} novalidate>
		{#if formError}<Callout tone="fail" live>{formError}</Callout>{/if}
		<TextField
			label={m.rename_field()}
			bind:value
			maxlength={MAX_LABEL_LENGTH * 2}
			autocomplete="off"
			hint={m.rename_hint({ count: MAX_LABEL_LENGTH })}
			error={fieldError}
			oninput={() => (rejected = null)}
		/>
	</form>
	{#snippet footer()}
		{#if label !== null}
			<Button
				variant="ghost"
				class="remove"
				busy={busy === 'remove'}
				disabled={busy !== null}
				onclick={() => void send(null)}
			>
				{m.rename_remove()}
			</Button>
		{/if}
		<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
		<Button
			variant="primary"
			type="submit"
			form={formId}
			busy={busy === 'save'}
			disabled={busy !== null}
		>
			{m.rename_save()}
		</Button>
	{/snippet}
</Dialog>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	:global(.dialog-footer .remove) {
		margin-right: auto;
	}
</style>
