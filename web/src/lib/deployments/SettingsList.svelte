<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import type { Deployment } from './queries';

	let { settings }: { settings: Deployment['settings'] } = $props();

	const entries = $derived(
		Object.entries(settings).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
	);
</script>

{#if entries.length}
	<Facts>
		{#each entries as [name, value] (name)}
			<dt class="mono">{name}</dt>
			<dd>
				{#if typeof value === 'object'}
					<Badge>{m.settings_secret_reference()}</Badge>
					<code>{value.secretRef}</code>
				{:else if typeof value === 'boolean'}
					{value ? m.common_yes() : m.common_no()}
				{:else}
					<span class="mono">{value}</span>
				{/if}
			</dd>
		{/each}
	</Facts>
{:else}
	<p class="none">{m.settings_none()}</p>
{/if}

<style>
	dt,
	dd :global(.mono),
	code {
		font-size: var(--text-sm);
	}

	.none {
		color: var(--text-2);
	}
</style>
