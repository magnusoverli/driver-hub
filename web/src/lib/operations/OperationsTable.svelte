<script lang="ts">
	import { shortDigest } from '#lib/deployments/view.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getClock, relativeTime } from '#lib/time/clock.svelte.js';
	import { formatDuration, formatTimestamp } from '#lib/time/format.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Spinner from '#lib/ui/Spinner.svelte';
	import Table from '#lib/ui/Table.svelte';
	import {
		operationDuration,
		operationKind,
		operationStateLabel,
		operationStateTones,
		operationSubject,
		type Operation
	} from './operations';

	type Props = { operations: Operation[]; label: string };

	let { operations, label }: Props = $props();
	const clock = getClock();
</script>

<Table {label}>
	<thead>
		<tr>
			<th scope="col">{m.operation_column_kind()}</th>
			<th scope="col">{m.operation_column_subject()}</th>
			<th scope="col">{m.operation_column_state()}</th>
			<th scope="col">{m.operation_column_started()}</th>
			<th scope="col">{m.operation_column_duration()}</th>
		</tr>
	</thead>
	<tbody>
		{#each operations as operation (operation.id)}
			{@const subject = operationSubject(operation)}
			<tr data-state={operation.state}>
				<td class="kind">{operationKind(operation)}</td>
				<td>
					<span class="subject">
						<span><code>{subject.driver}</code> {subject.detail}</span>
						{#if operation.kind === 'build' && operation.release}
							<span class="secondary">
								{m.operation_built({ version: operation.release.version })}
							</span>
						{/if}
						{#if operation.release}
							<span class="secondary mono" title={operation.release.digest}>
								{shortDigest(operation.release.digest)}
							</span>
						{/if}
					</span>
				</td>
				<td>
					<span class="state">
						<Badge tone={operationStateTones[operation.state]}>
							{#if operation.state === 'running'}<Spinner size={10} />{/if}
							{operationStateLabel(operation.state)}
						</Badge>
						{#if operation.state === 'failed'}
							<span class="reason">{operation.failure?.error ?? m.operation_failed_unknown()}</span>
						{:else if operation.state === 'interrupted'}
							<span class="reason">{m.operation_interrupted_reason()}</span>
						{/if}
					</span>
				</td>
				<td class="time" title={formatTimestamp(operation.startedAt)}>
					{relativeTime(Date.parse(operation.startedAt), clock.now)}
				</td>
				<td class="time">
					{#if operation.state === 'interrupted'}
						<span class="secondary">{m.operation_no_duration()}</span>
					{:else}
						{formatDuration(operationDuration(operation, clock.now))}
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</Table>

<style>
	.kind {
		font-weight: var(--weight-semibold);
		white-space: nowrap;
	}

	.subject,
	.state {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
	}

	.secondary {
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	.reason {
		max-width: 28rem;
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	[data-state='failed'] .reason {
		color: var(--fail);
	}

	.time {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
</style>
