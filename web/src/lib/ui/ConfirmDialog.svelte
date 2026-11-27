<script lang="ts">
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import Button from './Button.svelte';
	import Callout from './Callout.svelte';
	import Dialog from './Dialog.svelte';
	import TextField from './TextField.svelte';

	type Props = {
		open: boolean;
		title: string;
		description?: string;
		confirmLabel: string;
		/** For changes that cannot be undone: the operator types this to enable the button. */
		phrase?: string;
		/** Blocks confirming, for example while a precondition is not met. */
		blocked?: boolean;
		busy?: boolean;
		problem?: string | null;
		/** What happens, and what does not. */
		children?: Snippet;
		onConfirm: () => void;
	};

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel,
		phrase,
		blocked = false,
		busy = false,
		problem = null,
		children,
		onConfirm
	}: Props = $props();

	const formId = $props.id();
	let typed = $state('');
	$effect(() => {
		if (open) untrack(() => (typed = ''));
	});
	const matches = $derived(!phrase || typed.trim() === phrase);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (matches && !blocked && !busy) onConfirm();
	}
</script>

<Dialog bind:open {title} {description} width="md" dismissible={!busy}>
	<form id={formId} class="stack" onsubmit={submit} novalidate>
		{#if children}<div class="consequences">{@render children()}</div>{/if}
		{#if problem}<Callout tone="fail" title={problem} live />{/if}
		{#if phrase && !blocked}
			<TextField
				label={m.confirm_type({ phrase })}
				bind:value={typed}
				autocomplete="off"
				spellcheck={false}
			/>
		{/if}
	</form>
	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={() => (open = false)}>
			{m.common_cancel()}
		</Button>
		<Button variant="danger" type="submit" form={formId} {busy} disabled={!matches || blocked}>
			{confirmLabel}
		</Button>
	{/snippet}
</Dialog>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.consequences {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.consequences :global(ul) {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding-left: var(--space-5);
	}
</style>
