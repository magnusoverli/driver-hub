<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Badge, { type Tone } from '#lib/ui/Badge.svelte';
	import Table from '#lib/ui/Table.svelte';
	import PlacementFailures from './PlacementFailures.svelte';
	import type { Evaluation } from './queries';
	import { shortId } from './view';

	let { evaluations }: { evaluations: Evaluation[] } = $props();

	// Nomad's own words, so operators can match them with the Nomad UI and logs.
	const tones: Record<string, Tone> = { complete: 'neutral', blocked: 'warn', failed: 'fail' };
</script>

<Table label={m.evaluations_table_label()}>
	<thead>
		<tr>
			<th scope="col">{m.evaluations_column_id()}</th>
			<th scope="col">{m.evaluations_column_status()}</th>
			<th scope="col">{m.evaluations_column_trigger()}</th>
			<th scope="col">{m.evaluations_column_placement()}</th>
		</tr>
	</thead>
	<tbody>
		{#each evaluations as evaluation (evaluation.id)}
			<tr>
				<td><code title={evaluation.id}>{shortId(evaluation.id)}</code></td>
				<td><Badge tone={tones[evaluation.status] ?? 'neutral'}>{evaluation.status}</Badge></td>
				<td class="trigger">{evaluation.trigger}</td>
				<td class="placement">
					{#if evaluation.placementFailures.length}
						<PlacementFailures failures={evaluation.placementFailures} />
					{:else}
						<span class="none">{m.evaluations_no_failures()}</span>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</Table>

<style>
	.trigger {
		white-space: nowrap;
	}

	.placement {
		min-width: 16rem;
	}

	.none {
		color: var(--text-3);
	}
</style>
