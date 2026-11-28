<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/ui/Badge.svelte';
	import { fieldLabel } from './configuration-form';
	import type { Deployment } from './queries';

	let { settings }: { settings: Deployment['settings'] } = $props();

	const entries = $derived(
		Object.entries(settings).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
	);
</script>

{#if entries.length}
	<!-- Name above value: host names and keys stay whole in a narrow column. -->
	<dl class="settings">
		{#each entries as [name, value] (name)}
			<div class="setting">
				<dt>{fieldLabel(name)} <span class="key mono">{name}</span></dt>
				<dd>
					{#if typeof value === 'object'}
						<Badge>{m.configuration_secret_reference()}</Badge>
						<code>{value.secretRef}</code>
					{:else if typeof value === 'boolean'}
						{value ? m.common_yes() : m.common_no()}
					{:else}
						<span class="mono">{value}</span>
					{/if}
				</dd>
			</div>
		{/each}
	</dl>
{:else}
	<p class="none">{m.configuration_none()}</p>
{/if}

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.setting {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.key {
		margin-left: var(--space-1);
		font-size: var(--text-xs);
	}

	dt {
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	dd {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow-wrap: break-word;
	}

	dd :global(.mono),
	code {
		min-width: 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.none {
		color: var(--text-2);
	}
</style>
