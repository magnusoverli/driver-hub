<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import HelpLabel from './HelpLabel.svelte';

	type Props = Omit<HTMLTextareaAttributes, 'value'> & {
		label: string;
		value?: string;
		hint?: string;
		help?: string;
		error?: string | null;
		/** Monospaced, for tokens, identifiers and JSON. */
		code?: boolean;
	};

	let {
		label,
		value = $bindable(''),
		hint,
		help,
		error = null,
		code = false,
		rows = 4,
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
	<textarea
		{...rest}
		{id}
		{rows}
		class={{ code }}
		bind:value
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}></textarea>
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

	textarea {
		padding: var(--space-2) var(--space-3);
		border: 0;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow:
			inset 0 0 0 1px var(--border-strong),
			0 1px 1px var(--shadow-soft);
		font-size: var(--text-md);
		line-height: var(--leading);
		resize: vertical;
	}

	textarea.code {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	textarea:focus {
		outline: none;
		box-shadow:
			inset 0 0 0 1px var(--accent),
			0 0 0 3px var(--accent-soft);
	}

	textarea[aria-invalid='true'] {
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
