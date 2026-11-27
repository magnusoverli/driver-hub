<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { PlacementFailure } from './queries';

	let { failures }: { failures: PlacementFailure[] } = $props();
</script>

<ul class="failures">
	{#each failures as failure (failure.group)}
		<li>
			<p class="summary">
				{m.placement_summary({
					group: failure.group,
					evaluated: failure.nodesEvaluated,
					filtered: failure.nodesFiltered,
					exhausted: failure.nodesExhausted
				})}
			</p>
			{#if Object.keys(failure.constraints).length || Object.keys(failure.resources).length}
				<ul class="reasons">
					{#each Object.entries(failure.constraints) as [constraint, count] (constraint)}
						<li>
							<code>{constraint}</code>
							<span>{m.placement_constraint({ count })}</span>
						</li>
					{/each}
					{#each Object.entries(failure.resources) as [resource, count] (resource)}
						<li>
							<code>{resource}</code>
							<span>{m.placement_resource({ count })}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.failures,
	.reasons {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.reasons {
		gap: var(--space-1);
		margin-top: var(--space-1);
		padding-left: var(--space-3);
		border-left: 2px solid var(--border);
	}

	.summary {
		color: var(--text);
	}

	.reasons li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	code {
		overflow-wrap: anywhere;
		color: var(--text);
	}
</style>
