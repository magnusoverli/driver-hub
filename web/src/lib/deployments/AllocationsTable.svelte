<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { Allocation } from './queries';
	import { currentAllocation } from './status-path';
	import { shortId } from './view';

	let { allocations }: { allocations: Allocation[] } = $props();

	const current = $derived(currentAllocation(allocations));
	// Newest job version first, as operators read history.
	const ordered = $derived(
		[...allocations].sort((a, b) => (b.jobVersion ?? 0) - (a.jobVersion ?? 0))
	);
</script>

<Table label={m.allocations_table_label()}>
	<thead>
		<tr>
			<th scope="col">{m.allocations_column_id()}</th>
			<th scope="col">{m.allocations_column_client()}</th>
			<th scope="col">{m.allocations_column_desired()}</th>
			<th scope="col">{m.allocations_column_status()}</th>
			<th scope="col">{m.allocations_column_restarts()}</th>
			<th scope="col">{m.allocations_column_job_version()}</th>
		</tr>
	</thead>
	<tbody>
		{#each ordered as allocation (allocation.id)}
			<tr>
				<td>
					<span class="id">
						<code title={allocation.id}>{shortId(allocation.id)}</code>
						{#if allocation.logsUrl}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external operator-configured Nomad UI -->
							<a href={allocation.logsUrl} rel="noreferrer" target="_blank">
								{m.allocations_nomad_logs()}
							</a>
						{/if}
						{#if allocation === current}<Badge tone="accent">{m.allocations_current()}</Badge>{/if}
					</span>
				</td>
				<td><span class="mono">{allocation.host ?? '—'}</span></td>
				<td>{allocation.desired}</td>
				<td>
					{allocation.status}
					{#if allocation.lastEvent}<span class="secondary">{allocation.lastEvent}</span>{/if}
					{#if allocation.taskState && allocation.taskState !== allocation.status}
						<span class="secondary">
							{m.allocations_task_state({ state: allocation.taskState })}
						</span>
					{/if}
				</td>
				<td class="number">{allocation.restarts ?? '—'}</td>
				<td class="number">{allocation.jobVersion ?? '—'}</td>
			</tr>
		{/each}
	</tbody>
</Table>

<style>
	.id {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.secondary {
		display: block;
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	.number {
		font-variant-numeric: tabular-nums;
	}
</style>
