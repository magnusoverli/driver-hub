<script lang="ts">
	import StatusPath from '#lib/ui/StatusPath.svelte';
	import { statusPath, type StatusInput } from './status-path';
	import { condition, conditionLabel } from './view';

	let { input }: { input: StatusInput } = $props();
	const value = $derived(condition(input));
</script>

<span class="condition" data-condition={value}>
	<StatusPath path={statusPath(input)} />
	<span class="text">{conditionLabel(value)}</span>
</span>

<style>
	.condition {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		white-space: nowrap;
	}

	.text {
		color: var(--text-2);
		font-weight: var(--weight-medium);
	}

	[data-condition='connected'] .text {
		color: var(--ok);
	}

	[data-condition='check-failed'] .text,
	[data-condition='allocation-failed'] .text {
		color: var(--fail);
	}

	[data-condition='unavailable'] .text {
		color: var(--warn);
	}

	[data-condition='stopped'] .text {
		color: var(--text-3);
	}
</style>
