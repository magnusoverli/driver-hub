<script lang="ts" generics="T extends string">
	import { ToggleGroup } from 'bits-ui';

	type Tile = {
		value: T;
		label: string;
		count: number;
		/** Highlights the tile while its count is above zero, for problems. */
		alert?: boolean;
	};
	type Props = { label: string; items: Tile[]; value: T };

	let { label, items, value = $bindable() }: Props = $props();
</script>

<!-- Counts that double as the list's filter. One tile is always selected. -->
<ToggleGroup.Root
	type="single"
	class="status-tiles"
	aria-label={label}
	bind:value={() => value, (next) => (value = (next as T) || value)}
>
	{#each items as item (item.value)}
		<ToggleGroup.Item
			value={item.value}
			class="status-tile"
			data-alert={item.alert && item.count > 0 ? 'true' : undefined}
		>
			<span class="tile-count">{item.count}</span>
			<span class="tile-label">{item.label}</span>
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>

<style>
	:global(.status-tiles) {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
		gap: var(--space-3);
	}

	:global(.status-tile) {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-4);
		border: 0;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--ring);
		color: var(--text);
		text-align: left;
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease),
			box-shadow var(--duration-fast) var(--ease);
	}

	:global(.status-tile:hover) {
		background: var(--hover);
	}

	:global(.status-tile[data-state='on']) {
		box-shadow: inset 0 0 0 2px var(--accent);
	}

	:global(.status-tile:focus-visible) {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	:global(.status-tile[data-alert='true']) {
		background: var(--fail-soft);
	}

	:global(.status-tile[data-alert='true'] .tile-count) {
		color: var(--fail);
	}

	:global(.tile-count) {
		font-size: var(--text-2xl);
		font-weight: var(--weight-bold);
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}

	:global(.tile-label) {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
