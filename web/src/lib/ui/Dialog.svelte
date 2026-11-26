<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from 'bits-ui';
	import X from '@lucide/svelte/icons/x';
	import { m } from '#lib/paraglide/messages.js';

	type Props = {
		open: boolean;
		title: string;
		description?: string;
		/** A blocking dialog cannot be dismissed with Escape, the backdrop or a close button. */
		dismissible?: boolean;
		width?: 'sm' | 'md' | 'lg';
		footer?: Snippet;
		children?: Snippet;
		onOpenAutoFocus?: (event: Event) => void;
	};

	let {
		open = $bindable(),
		title,
		description,
		dismissible = true,
		width = 'sm',
		footer,
		children,
		onOpenAutoFocus
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content
			class="dialog-content dialog-{width}"
			escapeKeydownBehavior={dismissible ? 'close' : 'ignore'}
			interactOutsideBehavior={dismissible ? 'close' : 'ignore'}
			{onOpenAutoFocus}
		>
			<header class="dialog-header">
				<div class="dialog-heading">
					<Dialog.Title class="dialog-title">{title}</Dialog.Title>
					{#if description}
						<Dialog.Description class="dialog-description">{description}</Dialog.Description>
					{/if}
				</div>
				{#if dismissible}
					<Dialog.Close class="dialog-close" aria-label={m.common_close()}>
						<X size={16} aria-hidden="true" />
					</Dialog.Close>
				{/if}
			</header>
			{#if children}<div class="dialog-body">{@render children()}</div>{/if}
			{#if footer}<footer class="dialog-footer">{@render footer()}</footer>{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	/* Bits UI portals these parts to <body>, outside this component's scope. */
	:global(.dialog-content) {
		position: fixed;
		top: 18vh;
		left: 50%;
		z-index: 51;
		display: flex;
		flex-direction: column;
		width: calc(100vw - 2 * var(--space-4));
		max-height: 72vh;
		transform: translateX(-50%);
		border-radius: var(--radius-lg);
		background: var(--surface-raised);
		box-shadow: var(--elevated);
		animation: rise-in var(--duration) var(--ease);
	}

	:global(.dialog-content:focus-visible) {
		outline: none;
	}

	:global(.dialog-sm) {
		max-width: 26rem;
	}

	:global(.dialog-md) {
		max-width: 34rem;
	}

	:global(.dialog-lg) {
		max-width: 40rem;
	}

	.dialog-header {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-5) var(--space-3);
	}

	.dialog-heading {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		flex: 1;
	}

	:global(.dialog-title) {
		font-size: var(--text-lg);
		font-weight: var(--weight-bold);
	}

	:global(.dialog-description) {
		color: var(--text-2);
		font-size: var(--text-md);
	}

	:global(.dialog-close) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-sm);
		height: var(--control-sm);
		margin: -0.25rem -0.5rem 0 0;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}

	:global(.dialog-close:hover) {
		background: var(--hover);
		color: var(--text);
	}

	.dialog-body {
		padding: var(--space-2) var(--space-5) var(--space-5);
		overflow-y: auto;
	}

	.dialog-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--border);
	}

	@keyframes rise-in {
		from {
			opacity: 0;
			transform: translate(-50%, 6px) scale(0.98);
		}
	}
</style>
