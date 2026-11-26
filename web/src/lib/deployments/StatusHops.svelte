<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { CommunicationEvidence } from './queries';
	import { HOPS, statusPath, type Hop, type HopState, type StatusInput } from './status-path';
	import { hopExplanations } from './view';

	type Props = { input: StatusInput & { communicationEvidence: CommunicationEvidence } };

	let { input }: Props = $props();

	const path = $derived(statusPath(input));
	const explanations = $derived(hopExplanations(input));

	const hopLabel: Record<Hop, () => string> = {
		requested: m.status_hop_requested,
		allocation: m.status_hop_allocation,
		control: m.status_hop_control,
		approval: m.status_hop_approval
	};
	const stateLabel: Record<HopState, () => string> = {
		verified: m.hop_state_verified,
		failed: m.hop_state_failed,
		pending: m.hop_state_pending,
		unknown: m.hop_state_unknown,
		inactive: m.hop_state_inactive
	};
</script>

<ol class="hops">
	{#each HOPS as hop (hop)}
		<li data-state={path[hop]}>
			<span class="marker" aria-hidden="true"></span>
			<div class="content">
				<p class="heading">
					<span class="hop">{hopLabel[hop]()}</span>
					<span class="state">{stateLabel[path[hop]]()}</span>
				</p>
				<p class="explanation">{explanations[hop]}</p>
			</div>
		</li>
	{/each}
</ol>

<style>
	.hops {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		position: relative;
		display: flex;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
	}

	li + li {
		border-top: 1px solid var(--border);
	}

	/* The same segment shapes as the compact status path, upright. */
	.marker {
		flex: none;
		width: 6px;
		height: 1.25rem;
		margin-top: 0.1rem;
		border-radius: 3px;
	}

	[data-state='verified'] .marker {
		background: var(--ok);
	}

	[data-state='failed'] .marker {
		background: var(--fail);
	}

	[data-state='pending'] .marker {
		box-shadow: inset 0 0 0 1.5px var(--ok);
	}

	[data-state='unknown'] .marker {
		border: 1px dashed var(--text-3);
	}

	[data-state='inactive'] .marker {
		background: var(--border-strong);
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
	}

	.hop {
		font-weight: var(--weight-semibold);
	}

	.state {
		color: var(--text-3);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}

	[data-state='verified'] .state {
		color: var(--ok);
	}

	[data-state='failed'] .state {
		color: var(--fail);
	}

	.explanation {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
