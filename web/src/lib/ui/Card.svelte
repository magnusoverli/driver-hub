<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		/** Heading text; omit for a plain surface. */
		title?: string;
		/** Secondary text beside the heading. */
		description?: string;
		/** Controls aligned to the end of the header. */
		actions?: Snippet;
		/** Removes body padding, for tables and lists that run edge to edge. */
		flush?: boolean;
		headingLevel?: 2 | 3;
		children: Snippet;
	};

	let { title, description, actions, flush = false, headingLevel = 2, children }: Props = $props();
	const headingId = $props.id();
</script>

<section class="card" aria-labelledby={title ? headingId : undefined}>
	{#if title}
		<header>
			<div class="heading">
				<svelte:element this={`h${headingLevel}`} id={headingId}>{title}</svelte:element>
				{#if description}<p>{description}</p>{/if}
			</div>
			{#if actions}<div class="actions">{@render actions()}</div>{/if}
		</header>
	{/if}
	<div class={['body', { flush }]}>
		{@render children()}
	</div>
</section>

<style>
	.card {
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--ring);
		overflow: hidden;
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
	}

	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		flex: 1;
		min-width: 0;
	}

	.heading :global(h2),
	.heading :global(h3) {
		font-size: var(--text-md);
		font-weight: var(--weight-semibold);
	}

	.heading p {
		font-size: var(--text-sm);
		color: var(--text-3);
	}

	.actions {
		display: flex;
		gap: var(--space-2);
	}

	.body {
		padding: var(--space-4);
	}

	.flush {
		padding: 0;
	}
</style>
