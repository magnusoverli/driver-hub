<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { retainedQuery } from '#lib/catalog/queries.js';
	import ConditionLabel from '#lib/deployments/ConditionLabel.svelte';
	import { freshStatus } from '#lib/deployments/status-path.js';
	import { getClock } from '#lib/time/clock.svelte.js';
	import { deploymentsQuery, updatesQuery } from '#lib/deployments/queries.js';
	import {
		condition,
		deviceName,
		matchesFilter,
		needsAttention,
		sortByName,
		updateHints
	} from '#lib/deployments/view.js';
	import { operationsQuery } from '#lib/operations/operations.js';
	import OperationsTable from '#lib/operations/OperationsTable.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import {
		capabilitiesQuery,
		imageDistributionQuery,
		nomadConnectionQuery
	} from '#lib/system/queries.js';
	import { siteReadiness } from '#lib/system/readiness.js';
	import ReadinessList from '#lib/system/ReadinessList.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Freshness from '#lib/ui/Freshness.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';

	const api = getApi();
	const session = getSession();
	const capabilities = createQuery(() => capabilitiesQuery(api));
	const nomad = createQuery(() => nomadConnectionQuery(api));
	const images = createQuery(() => imageDistributionQuery(api));
	const cluster = $derived(capabilities.data?.nomadConfigured === true);
	const deployments = createQuery(() => ({ ...deploymentsQuery(api), enabled: cluster }));
	const updates = createQuery(() => ({ ...updatesQuery(api), enabled: cluster }));
	const retained = createQuery(() => ({ ...retainedQuery(api), enabled: cluster }));
	const operations = createQuery(() => ({
		...operationsQuery(api),
		enabled: capabilities.data?.asyncAcquisition === true
	}));

	const items = $derived(
		siteReadiness({
			capabilities: capabilities.data,
			nomad: nomad.data,
			nomadError: nomad.error,
			images: images.data,
			imagesError: images.error
		})
	);
	const attention = $derived(items.filter((item) => item.state === 'attention').length);
	const settled = $derived(items.every((item) => item.state !== 'checking'));
	const updatedAt = $derived(
		Math.min(
			capabilities.dataUpdatedAt,
			nomad.dataUpdatedAt,
			...(cluster ? [deployments.dataUpdatedAt] : [])
		)
	);

	const clock = getClock();
	const sorted = $derived(sortByName(deployments.data ?? []));
	const rows = $derived(sorted.map((row) => freshStatus(row, clock.now)));
	const troubled = $derived(rows.filter((row) => needsAttention(condition(row))));
	const counts = $derived({
		all: rows.length,
		attention: troubled.length,
		running: rows.filter((row) => matchesFilter(row, 'running')).length,
		stopped: rows.filter((row) => matchesFilter(row, 'stopped')).length
	});
	const hints = $derived(updateHints(rows, updates.data ?? [], retained.data ?? []));
	const updatable = $derived(rows.filter((row) => hints.has(row.nodeId)));
	const recent = $derived((operations.data ?? []).slice(0, 3));
	const runningWork = $derived(
		(operations.data ?? []).filter((operation) => operation.state === 'running').length
	);
	const failedWork = $derived(
		(operations.data ?? []).filter(
			(operation) => operation.state === 'failed' || operation.state === 'interrupted'
		).length
	);

	const list = resolve('/(app)/deployments');
</script>

<PageHeader title={m.overview_title()} description={m.overview_description()}>
	{#snippet meta()}
		<Freshness {updatedAt} fetching={capabilities.isFetching || deployments.isFetching} />
	{/snippet}
</PageHeader>

{#if capabilities.error}
	<Callout tone="fail" title={m.overview_error_title()} live>{capabilities.error.message}</Callout>
{:else if settled && attention > 0}
	<Callout tone="warn" title={m.overview_attention_title({ count: attention })}>
		{session.isAdmin ? m.overview_attention_admin() : m.overview_attention_viewer()}
	</Callout>
{/if}

<div class="grid">
	<div class="column">
		{#if cluster}
			<Card title={m.overview_devices_title()}>
				{#snippet actions()}
					<a class="more" href={list}>{m.overview_all_devices()}</a>
				{/snippet}
				{#if deployments.error && !deployments.data}
					<Callout tone="fail" title={errorMessage(deployments.error)} live />
				{:else if !deployments.data}
					<Loading label={m.deployments_loading()} />
				{:else if !rows.length}
					<p class="muted">{m.overview_no_devices()}</p>
					<a href={resolve('/(app)/catalog')}>{m.overview_stage_first()}</a>
				{:else}
					<div class="stats">
						<a class="stat" href={list}>
							<span class="value">{counts.all}</span>
							<span class="label">{m.overview_stat_devices()}</span>
						</a>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()d path plus a filter query -->
						<a class="stat" data-alert={counts.attention > 0} href={`${list}?show=attention`}>
							<span class="value">{counts.attention}</span>
							<span class="label">{m.deployments_filter_attention()}</span>
						</a>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()d path plus a filter query -->
						<a class="stat" href={`${list}?show=running`}>
							<span class="value">{counts.running}</span>
							<span class="label">{m.deployments_filter_running()}</span>
						</a>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()d path plus a filter query -->
						<a class="stat" href={`${list}?show=stopped`}>
							<span class="value">{counts.stopped}</span>
							<span class="label">{m.deployments_filter_stopped()}</span>
						</a>
					</div>
					{#if troubled.length}
						<ul class="devices after-stats" aria-label={m.overview_attention_list()}>
							{#each troubled.slice(0, 5) as row (row.nodeId)}
								<li>
									<a href={resolve('/(app)/deployments/[nodeId]', { nodeId: row.nodeId })}>
										{deviceName(row)}
									</a>
									<ConditionLabel input={row} />
								</li>
							{/each}
						</ul>
						{#if troubled.length > 5}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()d path plus a filter query -->
							<a class="more" href={`${list}?show=attention`}>
								{m.overview_more_attention({ count: troubled.length - 5 })}
							</a>
						{/if}
					{:else}
						<p class="muted">{m.overview_no_attention()}</p>
					{/if}
				{/if}
			</Card>

			<Card title={m.overview_updates_title()}>
				{#snippet actions()}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()d path plus a filter query -->
					<a class="more" href={`${resolve('/(app)/catalog')}?tab=updates`}>
						{m.overview_open_updates()}
					</a>
				{/snippet}
				{#if !deployments.data}
					<Loading label={m.catalog_loading()} />
				{:else if updatable.length}
					<ul class="devices">
						{#each updatable.slice(0, 5) as row (row.nodeId)}
							{@const hint = hints.get(row.nodeId)}
							<li>
								<a href={resolve('/(app)/deployments/[nodeId]', { nodeId: row.nodeId })}>
									{deviceName(row)}
								</a>
								<span class="muted mono">
									{row.version} → {hint?.version}
								</span>
								<span class="muted">
									{hint?.retained ? m.overview_update_ready() : m.overview_update_published()}
								</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="muted">{m.overview_no_updates()}</p>
				{/if}
			</Card>
		{/if}

		{#if capabilities.data?.asyncAcquisition}
			<Card
				title={m.overview_work_title()}
				description={runningWork || failedWork
					? m.overview_work_summary({ running: runningWork, failed: failedWork })
					: undefined}
				flush
			>
				{#snippet actions()}
					<a class="more" href={resolve('/(app)/activity')}>{m.catalog_all_activity()}</a>
				{/snippet}
				{#if recent.length}
					<OperationsTable operations={recent} label={m.overview_work_title()} />
				{:else if operations.data}
					<p class="muted padded">{m.overview_no_work()}</p>
				{:else}
					<Loading label={m.activity_loading()} />
				{/if}
			</Card>
		{/if}
	</div>

	<div class="column">
		<Card title={m.readiness_title()} description={m.readiness_description()} flush>
			<ReadinessList {items} showSettings={session.isAdmin} />
		</Card>
		<Card title={m.access_title()}>
			<dl class="access">
				<dt>{m.access_signed_in_as()}</dt>
				<dd>{session.operator?.username}</dd>
				<dt>{m.access_role()}</dt>
				<dd>{session.isAdmin ? m.role_admin() : m.role_viewer()}</dd>
			</dl>
			<p class="access-note">{session.isAdmin ? m.access_admin_note() : m.access_viewer_note()}</p>
		</Card>
	</div>
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
		align-items: start;
		gap: var(--space-5);
	}

	@media (max-width: 60rem) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: var(--space-3);
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--sunken);
		color: var(--text);
		text-decoration: none;
	}

	.stat:hover {
		background: var(--hover);
	}

	.stat:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.value {
		font-size: var(--text-2xl);
		font-weight: var(--weight-bold);
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}

	.label {
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	.stat[data-alert='true'] {
		background: var(--fail-soft);
	}

	.stat[data-alert='true'] .value {
		color: var(--fail);
	}

	.devices {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.after-stats {
		margin-top: var(--space-4);
	}

	.devices li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: var(--space-1) var(--space-4);
		padding: var(--space-2) 0;
	}

	.devices li > :global(:last-child) {
		justify-self: end;
	}

	.devices li + li {
		border-top: 1px solid var(--border);
	}

	.devices a {
		font-weight: var(--weight-semibold);
		text-decoration: none;
	}

	.devices a:hover,
	.more:hover {
		text-decoration: underline;
	}

	.more {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		text-decoration: none;
	}

	.muted {
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	.padded {
		padding: var(--space-4);
	}

	.access {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2) var(--space-4);
	}

	dt {
		color: var(--text-3);
	}

	dd {
		font-weight: var(--weight-semibold);
	}

	.access-note {
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
