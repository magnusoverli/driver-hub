<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LucideIcon } from '@lucide/svelte';

	type Props = { icon: LucideIcon; title: string; children?: Snippet; actions?: Snippet };

	let { icon: Icon, title, children, actions }: Props = $props();
</script>

<div class="empty">
	<span class="icon"><Icon size={20} aria-hidden="true" /></span>
	<h2>{title}</h2>
	{#if children}<div class="body">{@render children()}</div>{/if}
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-10) var(--space-6);
		text-align: center;
	}

	.icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		margin-bottom: var(--space-2);
		border-radius: var(--radius-md);
		background: var(--accent-soft);
		color: var(--accent-text);
	}

	h2 {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}

	.body {
		max-width: 32rem;
		color: var(--text-2);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
</style>
