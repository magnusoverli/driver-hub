<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Table from '#lib/ui/Table.svelte';
	import ConditionLabel from './ConditionLabel.svelte';
	import type { DeploymentSummary } from './queries';
	import { deviceName, shortId, type UpdateHint } from './view';

	type Props = { rows: DeploymentSummary[]; updates: ReadonlyMap<string, UpdateHint> };

	let { rows, updates }: Props = $props();
</script>

<Table label={m.deployments_table_label()}>
	<thead>
		<tr>
			<th scope="col">{m.deployments_column_device()}</th>
			<th scope="col">{m.deployments_column_driver()}</th>
			<th scope="col">{m.deployments_column_status()}</th>
			<th scope="col">{m.deployments_column_host()}</th>
		</tr>
	</thead>
	<tbody>
		{#each rows as row (row.nodeId)}
			{@const update = updates.get(row.nodeId)}
			<tr data-row-link>
				<td>
					<div class="device">
						<a
							class={['row-link', 'name', { unnamed: row.label === null }]}
							href={resolve('/(app)/deployments/[nodeId]', { nodeId: row.nodeId })}
						>
							{deviceName(row)}
						</a>
						<span class="meta">
							<span class="mono" title={row.nodeId}>{shortId(row.nodeId)}</span>
							{#if row.requiresOriginalStopped}
								<Badge tone="warn">{m.deployments_badge_migration()}</Badge>
							{/if}
						</span>
					</div>
				</td>
				<td>
					<div class="driver">
						<span class="driver-line"><span class="mono">{row.driverId}</span> {row.version}</span>
						{#if update}
							<Badge tone={update.retained ? 'accent' : 'neutral'}>
								{update.retained
									? m.deployments_update_ready({ version: update.version })
									: m.deployments_update_published({ version: update.version })}
							</Badge>
						{/if}
					</div>
				</td>
				<td><ConditionLabel input={row} /></td>
				<td class="host">
					{#if row.allocation?.host}
						<span class="mono">{row.allocation.host}</span>
					{:else}
						<span class="none">{m.deployments_no_host()}</span>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</Table>

<style>
	.device,
	.driver {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
	}

	/* Identifiers read as a unit; the table scrolls rather than breaking them at hyphens. */
	.driver-line {
		white-space: nowrap;
	}

	.name {
		color: var(--text);
		font-weight: var(--weight-semibold);
		text-decoration: none;
	}

	.name:hover {
		text-decoration: underline;
	}

	.unnamed {
		color: var(--text-2);
		font-style: italic;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	.host {
		white-space: nowrap;
	}

	.none {
		color: var(--text-3);
	}
</style>
