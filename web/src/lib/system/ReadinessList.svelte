<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleMinus from '@lucide/svelte/icons/circle-minus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';
	import Spinner from '#lib/ui/Spinner.svelte';
	import type { ReadinessItem, ReadinessState } from './readiness';

	let { items, showSettings }: { items: ReadinessItem[]; showSettings: boolean } = $props();

	const icons = { ready: CircleCheck, attention: TriangleAlert, optional: CircleMinus } as const;
	const stateLabel: Record<ReadinessState, () => string> = {
		ready: m.readiness_state_ready,
		attention: m.readiness_state_attention,
		optional: m.readiness_state_optional,
		checking: m.readiness_checking
	};
</script>

<ul class="readiness">
	{#each items as item (item.id)}
		<li data-state={item.state}>
			<span class="icon">
				{#if item.state === 'checking'}
					<Spinner size={16} />
				{:else}
					{@const Icon = icons[item.state]}
					<Icon size={17} aria-hidden="true" />
				{/if}
				<span class="visually-hidden">{stateLabel[item.state]()}:</span>
			</span>
			<span class="text">
				<span class="label">{item.label}</span>
				<span class="detail">{item.detail}</span>
			</span>
			{#if showSettings && item.settingsRoute}
				<a class="settings" href={resolve(item.settingsRoute)}>{m.readiness_open_settings()}</a>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.readiness {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	li + li {
		border-top: 1px solid var(--border);
	}

	.icon {
		display: inline-flex;
		flex: none;
		color: var(--text-3);
	}

	[data-state='ready'] .icon {
		color: var(--ok);
	}

	[data-state='attention'] .icon {
		color: var(--warn);
	}

	.text {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.label {
		font-weight: var(--weight-semibold);
	}

	.detail {
		color: var(--text-2);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.settings {
		flex: none;
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		text-decoration: none;
	}

	.settings:hover {
		text-decoration: underline;
	}
</style>
