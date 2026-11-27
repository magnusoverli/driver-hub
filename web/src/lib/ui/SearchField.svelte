<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = Omit<HTMLInputAttributes, 'value' | 'type'> & {
		/** Accessible name; the placeholder is not a label. */
		label: string;
		value?: string;
	};

	let { label, value = $bindable(''), class: className, ...rest }: Props = $props();
</script>

<div class={['search-field', className]}>
	<Search size={15} aria-hidden="true" />
	<input {...rest} type="search" aria-label={label} bind:value />
</div>

<style>
	.search-field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: var(--control);
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--border-strong);
		color: var(--text-3);
		transition: box-shadow var(--duration-fast) var(--ease);
	}

	.search-field:focus-within {
		box-shadow:
			inset 0 0 0 1px var(--accent),
			0 0 0 3px var(--accent-soft);
	}

	input {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: var(--text-md);
	}

	input:focus {
		outline: none;
	}

	input::placeholder {
		color: var(--text-3);
	}
</style>
