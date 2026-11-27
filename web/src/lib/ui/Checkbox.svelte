<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = Omit<HTMLInputAttributes, 'type' | 'checked'> & {
		checked?: boolean;
		/** The visible label. */
		children: Snippet;
		/** Explanation under the label, announced with it. */
		hint?: string;
	};

	let { checked = $bindable(false), children, hint, class: className, ...rest }: Props = $props();
	const id = $props.id();
</script>

<div class={['checkbox', className]}>
	<input
		{...rest}
		id="{id}-input"
		type="checkbox"
		bind:checked
		aria-describedby={hint ? `${id}-hint` : undefined}
	/>
	<label for="{id}-input">{@render children()}</label>
	{#if hint}<p id="{id}-hint" class="hint">{hint}</p>{/if}
</div>

<style>
	.checkbox {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: start;
		gap: var(--space-1) var(--space-3);
	}

	input {
		width: 1rem;
		height: 1rem;
		margin: 0.15rem 0 0;
		accent-color: var(--accent);
		cursor: pointer;
	}

	input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	label {
		font-weight: var(--weight-semibold);
		cursor: pointer;
	}

	.hint {
		grid-column: 2;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
