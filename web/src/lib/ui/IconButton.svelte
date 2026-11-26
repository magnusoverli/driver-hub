<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { LucideIcon } from '@lucide/svelte';

	type Props = Omit<HTMLButtonAttributes, 'children'> & {
		/** Accessible name; icon-only controls have no visible text. */
		label: string;
		icon: LucideIcon;
		size?: 'sm' | 'md';
		ref?: HTMLButtonElement | null;
	};

	let {
		label,
		icon: Icon,
		size = 'md',
		type = 'button',
		ref = $bindable(null),
		class: className,
		...rest
	}: Props = $props();
</script>

<button
	{...rest}
	bind:this={ref}
	{type}
	aria-label={label}
	title={label}
	class={['icon-button', size, className]}
>
	<Icon size={size === 'sm' ? 15 : 17} aria-hidden="true" />
</button>

<style>
	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control);
		height: var(--control);
		padding: 0;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease),
			color var(--duration-fast) var(--ease);
	}

	.icon-button:hover:not(:disabled),
	.icon-button[data-state='open'] {
		background: var(--hover);
		color: var(--text);
	}

	.icon-button:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.icon-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.sm {
		width: var(--control-sm);
		height: var(--control-sm);
		border-radius: var(--radius);
	}
</style>
