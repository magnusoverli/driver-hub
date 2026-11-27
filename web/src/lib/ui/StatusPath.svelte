<script lang="ts">
	import { HOPS, type Hop, type HopState, type StatusPath } from '#lib/deployments/status-path.js';
	import { m } from '#lib/paraglide/messages.js';

	let { path }: { path: StatusPath } = $props();

	const hopLabel: Record<Hop, () => string> = {
		requested: m.status_hop_requested,
		allocation: m.status_hop_allocation,
		control: m.status_hop_control,
		approval: m.status_hop_approval
	};

	const stateLabel: Record<HopState, () => string> = {
		verified: m.status_state_verified,
		failed: m.status_state_failed,
		pending: m.status_state_pending,
		unknown: m.status_state_unknown,
		inactive: m.status_state_inactive
	};

	const description = $derived(
		HOPS.map(
			(hop) =>
				`${hopLabel[hop]()}: ${hop === 'approval' ? m.device_status_manual() : stateLabel[path[hop]]()}`
		).join(', ')
	);
</script>

<span class="status-path" role="img" aria-label={description} title={description}>
	{#each HOPS as hop (hop)}
		<span class="segment" data-state={path[hop]}></span>
	{/each}
</span>

<style>
	.status-path {
		display: inline-flex;
		gap: 3px;
		vertical-align: middle;
	}

	.segment {
		width: 16px;
		height: 6px;
		border-radius: 3px;
	}

	[data-state='verified'] {
		background: var(--ok);
	}

	[data-state='failed'] {
		background: var(--fail);
	}

	[data-state='pending'] {
		box-shadow: inset 0 0 0 1.5px var(--ok);
	}

	[data-state='unknown'] {
		border: 1px dashed var(--text-3);
	}

	[data-state='inactive'] {
		background: var(--border-strong);
	}
</style>
