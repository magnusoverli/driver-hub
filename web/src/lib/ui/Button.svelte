<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { LucideIcon } from '@lucide/svelte';
	import Spinner from './Spinner.svelte';

	type Props = HTMLAttributes<HTMLElement> & {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md';
		/** Renders a link styled as a button. */
		href?: string;
		type?: 'button' | 'submit' | 'reset';
		/** Id of the form a submit button belongs to when it sits outside it, as in dialog footers. */
		form?: string;
		disabled?: boolean;
		/** Shows progress and blocks repeat activation while an action runs. */
		busy?: boolean;
		icon?: LucideIcon;
		fullWidth?: boolean;
		children: Snippet;
	};

	let {
		variant = 'secondary',
		size = 'md',
		href,
		type = 'button',
		disabled = false,
		busy = false,
		icon: Icon,
		fullWidth = false,
		children,
		class: className,
		...rest
	}: Props = $props();

	const iconSize = $derived(size === 'sm' ? 14 : 16);
</script>

{#snippet content()}
	{#if busy}
		<Spinner size={iconSize} />
	{:else if Icon}
		<Icon size={iconSize} aria-hidden="true" />
	{/if}
	<span>{@render children()}</span>
{/snippet}

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass a resolve()d path -->
	<a {...rest} {href} class={['button', variant, size, { fullWidth }, className]}>
		{@render content()}
	</a>
{:else}
	<button
		{...rest}
		{type}
		disabled={disabled || busy}
		aria-busy={busy || undefined}
		class={['button', variant, size, { fullWidth }, className]}
	>
		{@render content()}
	</button>
{/if}

<style>
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		height: var(--control);
		padding: 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-md);
		font-size: var(--text-md);
		font-weight: var(--weight-semibold);
		line-height: 1;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease),
			color var(--duration-fast) var(--ease),
			box-shadow var(--duration-fast) var(--ease);
	}

	.button:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.button[aria-busy='true'] {
		cursor: progress;
		opacity: 0.8;
	}

	.sm {
		height: var(--control-sm);
		padding: 0 var(--space-3);
		border-radius: var(--radius);
		font-size: var(--text-sm);
	}

	.fullWidth {
		width: 100%;
	}

	.primary {
		background: var(--accent);
		color: var(--accent-ink);
	}

	.primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.secondary {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--ring);
	}

	.secondary:hover:not(:disabled) {
		background: var(--hover);
	}

	.ghost {
		background: transparent;
		color: var(--text-2);
	}

	.ghost:hover:not(:disabled) {
		background: var(--hover);
		color: var(--text);
	}

	.danger {
		background: var(--fail);
		color: light-dark(#ffffff, #1d0d05);
	}

	.danger:hover:not(:disabled) {
		background: color-mix(in oklab, var(--fail) 88%, var(--text));
	}
</style>
