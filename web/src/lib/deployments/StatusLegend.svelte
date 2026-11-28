<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { HopState } from './status-path';

	const steps = [
		m.legend_step_requested,
		m.legend_step_allocation,
		m.legend_step_control,
		m.legend_step_approval
	];
	const states: { state: HopState; label: () => string }[] = [
		{ state: 'verified', label: m.legend_state_verified },
		{ state: 'failed', label: m.legend_state_failed },
		{ state: 'pending', label: m.legend_state_pending },
		{ state: 'unknown', label: m.legend_state_unknown },
		{ state: 'inactive', label: m.legend_state_inactive }
	];
</script>

<!-- Explains the four-part status path used in the device list. -->
<div class="legend">
	<p>
		<span class="title">{m.legend_title()}</span>
		{#each steps as step, index (index)}
			{#if index}<span class="arrow" aria-hidden="true">→</span>{/if}
			<span>{step()}</span>
		{/each}
	</p>
	<ul aria-label={m.legend_states()}>
		{#each states as item (item.state)}
			<li><span class="segment" data-state={item.state}></span>{item.label()}</li>
		{/each}
	</ul>
</div>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-2) var(--space-5);
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	p {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
	}

	.title {
		color: var(--text-2);
		font-weight: var(--weight-semibold);
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	/* The same shapes as the status path. */
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
