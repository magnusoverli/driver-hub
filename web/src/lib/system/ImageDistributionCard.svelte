<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { getApi } from '#lib/api/context.js';
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import { imageDistributionSummary, imageStateLabel, imageStateTone } from './image-distribution';
	import { imageDistributionQuery } from './queries';
	import type { Snippet } from 'svelte';
	import HelpTip from '#lib/ui/HelpTip.svelte';

	/** Settings for distribution, shown with its status. */
	let { children }: { children?: Snippet } = $props();

	const api = getApi();
	const images = createQuery(() => imageDistributionQuery(api));
</script>

<Card title={m.images_title()} description={m.images_description()}>
	{#snippet actions()}
		<HelpTip label={m.images_title()} help={m.images_note()} />
	{/snippet}
	{#if images.error}
		<Callout tone="fail" live>
			{m.readiness_images_unknown({ detail: images.error.message })}
		</Callout>
	{:else if !images.data}
		<p class="detail">{m.readiness_checking()}</p>
	{:else}
		{@const status = images.data}
		<Facts>
			<dt>{m.images_state()}</dt>
			<dd>
				<Badge tone={imageStateTone(status.state)}>{imageStateLabel(status.state)}</Badge>
				<span class="detail">{imageDistributionSummary(status)}</span>
			</dd>
			{#if status.running}
				<dt>{m.images_clients()}</dt>
				<dd>{m.images_clients_value({ upToDate: status.upToDate, running: status.running })}</dd>
			{/if}
			{#if status.state !== 'not_configured'}
				<dt>{m.images_count()}</dt>
				<dd>{status.images}</dd>
			{/if}
			{#if status.source}
				<dt>{m.images_source()}</dt>
				<dd><code>{status.source}</code></dd>
			{/if}
		</Facts>
		{#if status.problems.length}
			<div class="problems">
				<p class="problems-title">{m.images_problems()}</p>
				<ul>
					{#each status.problems as problem, index (index)}
						<li>
							{m.images_problem({
								host: problem.host ?? m.images_problem_unknown_host(),
								event: problem.event ?? m.images_problem_no_event()
							})}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
	{#if children}<div class="settings">{@render children()}</div>{/if}
</Card>

<style>
	.settings {
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border);
	}

	.detail {
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	dd .detail {
		display: block;
		margin-top: var(--space-1);
	}

	.problems {
		margin-top: var(--space-3);
	}

	.problems-title {
		font-weight: var(--weight-semibold);
	}

	.problems ul {
		margin: var(--space-1) 0 0;
		padding-left: var(--space-5);
		color: var(--text-2);
	}
</style>
