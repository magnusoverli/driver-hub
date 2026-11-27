<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tabs } from 'bits-ui';

	type Tab = { value: string; label: string; count?: number; panel: Snippet };
	type Props = { label: string; tabs: Tab[]; value?: string };

	let { label, tabs, value = $bindable(tabs[0]?.value ?? '') }: Props = $props();
</script>

<Tabs.Root bind:value class="tabs">
	<Tabs.List class="tabs-list" aria-label={label}>
		{#each tabs as tab (tab.value)}
			<Tabs.Trigger value={tab.value} class="tabs-trigger">
				{tab.label}
				{#if tab.count !== undefined}<span class="tabs-count">{tab.count}</span>{/if}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>
	{#each tabs as tab (tab.value)}
		<Tabs.Content value={tab.value} class="tabs-panel">
			{@render tab.panel()}
		</Tabs.Content>
	{/each}
</Tabs.Root>

<style>
	:global(.tabs-list) {
		display: flex;
		gap: var(--space-1);
		padding: 0 var(--space-2);
		border-bottom: 1px solid var(--border);
		overflow-x: auto;
	}

	:global(.tabs-trigger) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: 2.75rem;
		padding: 0 var(--space-3);
		border: 0;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		background: transparent;
		color: var(--text-2);
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		cursor: pointer;
	}

	:global(.tabs-trigger:hover) {
		color: var(--text);
	}

	:global(.tabs-trigger[data-state='active']) {
		border-bottom-color: var(--accent);
		color: var(--text);
		font-weight: var(--weight-semibold);
	}

	:global(.tabs-trigger:focus-visible) {
		outline: none;
		box-shadow: inset var(--focus-ring);
		border-radius: var(--radius);
	}

	:global(.tabs-count) {
		min-width: 1.25rem;
		padding: 0 var(--space-1);
		border-radius: var(--radius-pill);
		background: var(--sunken);
		color: var(--text-3);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	:global(.tabs-panel:focus-visible) {
		outline: none;
		box-shadow: inset var(--focus-ring);
	}
</style>
