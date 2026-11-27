<script lang="ts" generics="T extends string">
	import { ToggleGroup } from 'bits-ui';

	type Item = { value: T; label: string; count?: number };
	type Props = {
		/** Names the group, for example "Show deployments". */
		label: string;
		items: Item[];
		value: T;
	};

	let { label, items, value = $bindable() }: Props = $props();
</script>

<!-- One option is always selected: activating the selected one again keeps it. -->
<ToggleGroup.Root
	type="single"
	class="filter-tabs"
	aria-label={label}
	bind:value={() => value, (next) => (value = (next as T) || value)}
>
	{#each items as item (item.value)}
		<ToggleGroup.Item value={item.value} class="filter-tab">
			<span>{item.label}</span>
			{#if item.count !== undefined}<span class="filter-count">{item.count}</span>{/if}
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>

<style>
	:global(.filter-tabs) {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 3px;
		border-radius: var(--radius-md);
		background: var(--sunken);
	}

	:global(.filter-tab) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: calc(var(--control) - 6px);
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease),
			color var(--duration-fast) var(--ease);
	}

	:global(.filter-tab:hover) {
		color: var(--text);
	}

	:global(.filter-tab[data-state='on']) {
		background: var(--surface);
		box-shadow: var(--ring);
		color: var(--text);
		font-weight: var(--weight-semibold);
	}

	:global(.filter-tab:focus-visible) {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	:global(.filter-count) {
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
</style>
