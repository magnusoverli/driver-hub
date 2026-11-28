<script lang="ts" module>
	export type SetupStep = {
		id: string;
		title: string;
		detail: string;
		done: boolean;
		/** What to do next; only the first unfinished step's action is emphasised. */
		action?: { label: string; href?: string; onclick?: () => void; disabled?: boolean };
	};
</script>

<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/ui/Button.svelte';

	let { steps }: { steps: SetupStep[] } = $props();
	const next = $derived(steps.find((step) => !step.done)?.id);
</script>

<ol class="checklist">
	{#each steps as step, index (step.id)}
		<li data-done={step.done} data-next={step.id === next}>
			<span class="marker" aria-hidden="true">
				{#if step.done}<CircleCheck size={20} />{:else}{index + 1}{/if}
			</span>
			<div class="text">
				<p class="title">
					{step.title}
					{#if step.done}<span class="visually-hidden">: {m.setup_step_done()}</span>{/if}
				</p>
				<p class="detail">{step.detail}</p>
			</div>
			{#if step.action && !step.done}
				<Button
					size="sm"
					variant={step.id === next ? 'primary' : 'secondary'}
					href={step.action.href}
					onclick={step.action.onclick}
					disabled={step.action.disabled}
				>
					{step.action.label}
				</Button>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.checklist {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4);
	}

	li + li {
		border-top: 1px solid var(--border);
	}

	.marker {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-pill);
		background: var(--sunken);
		color: var(--text-2);
		font-weight: var(--weight-semibold);
		font-variant-numeric: tabular-nums;
	}

	[data-next='true'] .marker {
		background: var(--accent-soft);
		color: var(--accent-text);
	}

	[data-done='true'] .marker {
		background: transparent;
		color: var(--ok);
	}

	.text {
		flex: 1;
		min-width: 0;
	}

	.title {
		font-weight: var(--weight-semibold);
	}

	[data-done='true'] .title {
		color: var(--text-2);
	}

	.detail {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
