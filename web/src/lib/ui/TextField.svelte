<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import HelpLabel from './HelpLabel.svelte';

	type Props = Omit<HTMLInputAttributes, 'value'> & {
		label: string;
		value?: string;
		/** Shown under the field and announced with it. */
		hint?: string;
		help?: string;
		/** Marks the field invalid; replaces the hint while present. */
		error?: string | null;
		ref?: HTMLInputElement | null;
	};

	let {
		label,
		value = $bindable(''),
		hint,
		help,
		error = null,
		ref = $bindable(null),
		type = 'text',
		class: className,
		...rest
	}: Props = $props();

	const id = $props.id();
	// The error replaces the hint while present; help text is always available.
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
		{type}
		bind:this={ref}
		bind:value
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
		color: var(--text);
	}

	input {
		height: var(--control);
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow:
			inset 0 0 0 1px var(--border-strong),
			0 1px 1px var(--shadow-soft);
		font-size: var(--text-md);
		transition: box-shadow var(--duration-fast) var(--ease);
	}

	input::placeholder {
		color: var(--text-3);
	}

	input:hover:not(:disabled):not(:focus) {
		box-shadow: inset 0 0 0 1px var(--text-3);
	}

	input:focus {
		outline: none;
		box-shadow:
			inset 0 0 0 1px var(--accent),
			0 0 0 3px var(--accent-soft);
	}

	input[aria-invalid='true'] {
		box-shadow: inset 0 0 0 1px var(--fail);
	}

	input[aria-invalid='true']:focus {
		box-shadow:
			inset 0 0 0 1px var(--fail),
			0 0 0 3px var(--fail-soft);
	}

	input:disabled,
	input[readonly] {
		background: var(--sunken);
		color: var(--text-2);
	}

	.message {
		font-size: var(--text-sm);
		color: var(--text-3);
	}

	.error {
		color: var(--fail);
	}
</style>
