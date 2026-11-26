<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<kbd>{@render children()}</kbd>

<style>
	kbd {
		display: inline-flex;
		align-items: center;
		height: 1.25rem;
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--sunken);
		color: var(--text-3);
		font-size: var(--text-xs);
		line-height: 1;
	}
</style>
