<script lang="ts" generics="T extends string">
	import type { HTMLSelectAttributes } from 'svelte/elements';

	type Props = Omit<HTMLSelectAttributes, 'value'> & {
		label: string;
		options: { value: T; label: string }[];
		value: T;
		hint?: string;
	};

	let { label, options, value = $bindable(), hint, class: className, ...rest }: Props = $props();
	const id = $props.id();
</script>

<div class={['field', className]}>
	<label for={id}>{label}</label>
	<select {...rest} {id} bind:value aria-describedby={hint ? `${id}-hint` : undefined}>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
	{#if hint}<p id="{id}-hint" class="message">{hint}</p>{/if}
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

	select {
		height: var(--control);
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow:
			inset 0 0 0 1px var(--border-strong),
			0 1px 1px var(--shadow-soft);
		color: var(--text);
		font-size: var(--text-md);
	}

	select:focus {
		outline: none;
		box-shadow:
			inset 0 0 0 1px var(--accent),
			0 0 0 3px var(--accent-soft);
	}

	.message {
		font-size: var(--text-sm);
		color: var(--text-3);
	}
</style>
