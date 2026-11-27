<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A two-column description list of term and value pairs; pass <dt> and <dd> elements. */
	let { children }: { children: Snippet } = $props();
</script>

<dl class="facts">{@render children()}</dl>

<style>
	.facts {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: var(--space-3) var(--space-4);
		align-items: baseline;
	}

	.facts :global(dt) {
		color: var(--text-3);
	}

	.facts :global(dd) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		min-width: 0;
		overflow-wrap: anywhere;
	}
</style>
