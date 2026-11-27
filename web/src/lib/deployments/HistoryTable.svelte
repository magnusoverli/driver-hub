<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { HistoryEntry } from './queries';
	import { imageDigest, shortDigest } from './view';

	type Props = { history: HistoryEntry[]; currentRevision: number };

	let { history, currentRevision }: Props = $props();
</script>

<Table label={m.history_table_label()}>
	<thead>
		<tr>
			<th scope="col">{m.history_column_job_version()}</th>
			<th scope="col">{m.history_column_version()}</th>
			<th scope="col">{m.history_column_requested()}</th>
			<th scope="col">{m.history_column_image()}</th>
			<th scope="col">{m.history_column_revision()}</th>
		</tr>
	</thead>
	<tbody>
		{#each history as entry (entry.jobVersion)}
			<tr>
				<td>
					<span class="version">
						<span class="mono">{entry.jobVersion}</span>
						{#if entry.revision === currentRevision}
							<Badge tone="accent">{m.history_current()}</Badge>
						{/if}
					</span>
				</td>
				<td><span class="mono">{entry.version}</span></td>
				<td>{entry.requested === 'running' ? m.requested_running() : m.requested_stopped()}</td>
				<td><code title={entry.image}>{shortDigest(imageDigest(entry.image))}</code></td>
				<td><span class="mono">{entry.revision}</span></td>
			</tr>
		{/each}
	</tbody>
</Table>

<style>
	.version {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
</style>
