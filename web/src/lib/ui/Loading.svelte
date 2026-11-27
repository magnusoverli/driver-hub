<script lang="ts">
	import Spinner from './Spinner.svelte';

	/** What is loading, for example "Loading deployments". Announced politely. */
	let { label }: { label: string } = $props();
</script>

<div class="loading" role="status">
	<Spinner size={16} />
	<span>{label}</span>
</div>

<style>
	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-10) var(--space-6);
		color: var(--text-3);
	}
</style>
