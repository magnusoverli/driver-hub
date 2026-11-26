<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = { title: string; description?: string; actions?: Snippet; meta?: Snippet };

	let { title, description, actions, meta }: Props = $props();
</script>

<svelte:head>
	<title>{title} · Driver Hub</title>
</svelte:head>

<header class="page-header">
	<div class="text">
		<h1>{title}</h1>
		{#if description}<p>{description}</p>{/if}
	</div>
	{#if meta}<div class="meta">{@render meta()}</div>{/if}
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
	.page-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-4);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		flex: 1;
		min-width: 16rem;
	}

	h1 {
		font-size: var(--text-2xl);
		font-weight: var(--weight-bold);
		letter-spacing: -0.02em;
	}

	p {
		color: var(--text-2);
	}

	.meta {
		font-size: var(--text-sm);
		color: var(--text-3);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
	}
</style>
