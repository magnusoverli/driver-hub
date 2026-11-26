<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { getClock, relativeTime } from '#lib/time/clock.svelte.js';
	import Spinner from './Spinner.svelte';

	type Props = {
		/** When the data shown was received; 0 means never. */
		updatedAt: number;
		fetching?: boolean;
	};

	let { updatedAt, fetching = false }: Props = $props();
	const clock = getClock();
	const age = $derived(updatedAt ? relativeTime(updatedAt, clock.now) : null);
</script>

<span class="freshness" aria-live="off">
	{#if fetching}<Spinner size={12} />{/if}
	{#if age}
		<span>{m.freshness_updated({ age })}</span>
	{/if}
</span>

<style>
	.freshness {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
</style>
