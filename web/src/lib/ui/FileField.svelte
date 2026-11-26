<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import HelpLabel from './HelpLabel.svelte';

	type Props = Omit<HTMLInputAttributes, 'type' | 'value'> & {
		label: string;
		files?: FileList;
		hint?: string;
		help?: string;
		error?: string | null;
	};

	let {
		label,
		files = $bindable(),
		hint,
		help,
		error = null,
		class: className,
		...rest
	}: Props = $props();

	const id = $props.id();
	const describedBy = $derived(
		[help && `${id}-help`, error ? `${id}-error` : hint && `${id}-hint`]
			.filter(Boolean)
			.join(' ') || undefined
	);
</script>

<div class={['field', className]}>
	{#if help}<HelpLabel field={id} {label} {help} />{:else}<label for={id}>{label}</label>{/if}
	<input
		{...rest}
		{id}
		type="file"
		bind:files
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
	/>
	{#if error}
		<p id="{id}-error" class="message error">{error}</p>
	{:else if hint}
		<p id="{id}-hint" class="message">{hint}</p>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	label {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}

	input {
		min-width: 0;
		padding: var(--space-2);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--border-strong);
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	input::file-selector-button {
		height: var(--control-sm);
		margin-right: var(--space-3);
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius);
		background: var(--sunken);
		color: var(--text);
		font: inherit;
		font-weight: var(--weight-semibold);
		cursor: pointer;
	}

	input:hover::file-selector-button {
		background: var(--hover);
	}

	input:focus-visible {
		outline: none;
		box-shadow:
			inset 0 0 0 1px var(--accent),
			0 0 0 3px var(--accent-soft);
	}

	input[aria-invalid='true'] {
		box-shadow: inset 0 0 0 1px var(--fail);
	}

	.message {
		font-size: var(--text-sm);
		color: var(--text-3);
	}

	.error {
		color: var(--fail);
	}
</style>
