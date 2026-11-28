<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { CommunicationEvidence } from './queries';
	import { HOPS, statusPath, type Hop, type HopState, type StatusInput } from './status-path';

	type Props = { input: StatusInput & { communicationEvidence?: CommunicationEvidence } };

	let { input }: Props = $props();
	const path = $derived(statusPath(input));

	const hopLabel: Record<Hop, () => string> = {
		requested: m.legend_step_requested,
		allocation: m.legend_step_allocation,
		control: m.legend_step_control,
		approval: m.legend_step_approval
	};
	const stateLabel: Record<HopState, () => string> = {
		verified: m.hop_state_verified,
		failed: m.hop_state_failed,
		pending: m.hop_state_pending,
		unknown: m.hop_state_unknown,
		inactive: m.hop_state_inactive
	};

	function state(hop: Hop): string {
		if (hop === 'approval') return m.steps_approval_state();
		if (hop === 'control' && input.communicationEvidence?.reason === 'no_control_check') {
			return m.control_not_provided();
		}
		return stateLabel[path[hop]]();
	}
</script>

<!-- The status path, large and labelled: from Hub's request to approval in VideoIPath. -->
<ol class="steps">
	{#each HOPS as hop (hop)}
		<li data-state={path[hop]}>
			<span class="bar" aria-hidden="true"></span>
			<span class="label">{hopLabel[hop]()}</span>
			<span class="state">{state(hop)}</span>
		</li>
	{/each}
</ol>

<style>
	.steps {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	@media (max-width: 40rem) {
		.steps {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	li {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.bar {
		height: 8px;
		margin-bottom: var(--space-1);
		border-radius: 4px;
	}

	.label {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}

	.state {
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	[data-state='verified'] .bar {
		background: var(--ok);
	}

	[data-state='verified'] .state {
		color: var(--ok);
	}

	[data-state='failed'] .bar {
		background: var(--fail);
	}

	[data-state='failed'] .state {
		color: var(--fail);
	}

	[data-state='pending'] .bar {
		box-shadow: inset 0 0 0 2px var(--ok);
	}

	[data-state='unknown'] .bar {
		border: 1.5px dashed var(--text-3);
	}

	[data-state='inactive'] .bar {
		background: var(--border-strong);
	}
</style>
