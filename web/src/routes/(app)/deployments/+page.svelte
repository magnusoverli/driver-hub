<script lang="ts">
	import { untrack } from 'svelte';
	import Layers from '@lucide/svelte/icons/layers';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Server from '@lucide/svelte/icons/server';
	import { createQuery } from '@tanstack/svelte-query';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getApi } from '#lib/api/context.js';
	import { retainedQuery } from '#lib/catalog/queries.js';
	import DeploymentTable from '#lib/deployments/DeploymentTable.svelte';
	import { deploymentsQuery, updatesQuery } from '#lib/deployments/queries.js';
	import {
		DEPLOYMENT_FILTERS,
		filterQuery,
		matchesFilter,
		matchesSearch,
		sortByName,
		updateHints,
		type DeploymentFilter
	} from '#lib/deployments/view.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { getNotices } from '#lib/shell/notices.js';
	import { capabilitiesQuery } from '#lib/system/queries.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import FilterTabs from '#lib/ui/FilterTabs.svelte';
	import Freshness from '#lib/ui/Freshness.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';

	const api = getApi();
	const session = getSession();
	// Outcomes of actions that led here, such as deleting a deployment.
	const notices = getNotices().take('/(app)/deployments');
	const capabilities = createQuery(() => capabilitiesQuery(api));
	// Without a cluster the manager has no deployments to list and answers 503.
	const clusterConfigured = $derived(capabilities.data?.nomadConfigured === true);
	const deployments = createQuery(() => ({
		...deploymentsQuery(api),
		enabled: clusterConfigured
	}));
	const updates = createQuery(() => ({ ...updatesQuery(api), enabled: clusterConfigured }));
	const retained = createQuery(() => ({ ...retainedQuery(api), enabled: clusterConfigured }));

	// The filter lives in the address, so returning from a device restores the same view.
	// Read from the browser's address: after going back, it carries the view that was last shown.
	const initial = new URL(location.href).searchParams;
	let search = $state(initial.get('q') ?? '');
	let filter = $state<DeploymentFilter>(
		DEPLOYMENT_FILTERS.find((value) => value === initial.get('show')) ?? 'all'
	);

	// Depends on the filter only: replacing the history entry updates the page store, and
	// reading that here would run this effect again.
	$effect(() => {
		const next = filterQuery(search, filter);
		untrack(() => {
			if (next === location.search) return;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()d path plus query
			void replaceState(`${resolve('/(app)/deployments')}${next}`, page.state);
		});
	});

	const rows = $derived(sortByName(deployments.data ?? []));
	const visible = $derived(
		rows.filter((row) => matchesFilter(row, filter) && matchesSearch(row, search))
	);
	const hints = $derived(updateHints(rows, updates.data ?? [], retained.data ?? []));
	const filterLabels: Record<DeploymentFilter, () => string> = {
		all: m.deployments_filter_all,
		attention: m.deployments_filter_attention,
		running: m.deployments_filter_running,
		stopped: m.deployments_filter_stopped
	};
	const filterItems = $derived(
		DEPLOYMENT_FILTERS.map((value) => ({
			value,
			label: filterLabels[value](),
			count: rows.filter((row) => matchesFilter(row, value)).length
		}))
	);

	function clearFilters() {
		search = '';
		filter = 'all';
	}
</script>

<PageHeader title={m.nav_deployments()} description={m.deployments_description()}>
	{#snippet meta()}
		{#if clusterConfigured}
			<Freshness updatedAt={deployments.dataUpdatedAt} fetching={deployments.isFetching} />
		{/if}
	{/snippet}
</PageHeader>

{#each notices as notice, index (index)}
	<Callout tone={notice.tone} title={notice.title} live>{notice.body}</Callout>
{/each}

{#if capabilities.error}
	<Callout tone="fail" title={m.deployments_error_title()} live>
		{capabilities.error.message}
	</Callout>
{:else if !capabilities.data}
	<Card><Loading label={m.deployments_loading()} /></Card>
{:else if !clusterConfigured}
	<Card>
		<EmptyState icon={Server} title={m.deployments_no_cluster_title()}>
			<p>
				{session.isAdmin ? m.deployments_no_cluster_admin() : m.deployments_no_cluster_viewer()}
			</p>
			{#snippet actions()}
				{#if session.isAdmin}
					<Button variant="primary" href={resolve('/(app)/site/nomad')}>
						{m.deployments_no_cluster_action()}
					</Button>
				{/if}
			{/snippet}
		</EmptyState>
	</Card>
{:else if deployments.error && !deployments.data}
	<Callout tone="fail" title={m.deployments_error_title()} live>
		<p>{deployments.error.message}</p>
	</Callout>
	<div>
		<Button onclick={() => deployments.refetch()} busy={deployments.isFetching}>
			{m.common_retry()}
		</Button>
	</div>
{:else if !deployments.data}
	<Card><Loading label={m.deployments_loading()} /></Card>
{:else if rows.length === 0}
	<Card>
		<EmptyState icon={Layers} title={m.deployments_empty_title()}>
			<p>{m.deployments_empty_body()}</p>
		</EmptyState>
	</Card>
{:else}
	{#if deployments.error}
		<Callout tone="warn" title={m.deployments_stale_title()} live>
			{m.deployments_stale_body({ detail: deployments.error.message })}
		</Callout>
	{/if}
	<Card flush>
		<div class="toolbar">
			<SearchField
				class="search"
				label={m.deployments_search_label()}
				placeholder={m.deployments_search_placeholder()}
				bind:value={search}
			/>
			<FilterTabs label={m.deployments_filter_label()} items={filterItems} bind:value={filter} />
		</div>
		{#if visible.length}
			<DeploymentTable rows={visible} updates={hints} />
		{:else}
			<EmptyState icon={SearchX} title={m.deployments_no_match_title()}>
				<p>{m.deployments_no_match_body()}</p>
				{#snippet actions()}
					<Button onclick={clearFilters}>{m.deployments_clear_filters()}</Button>
				{/snippet}
			</EmptyState>
		{/if}
	</Card>
	<p class="results" role="status">
		{m.deployments_showing({ shown: visible.length, total: rows.length })}
	</p>
{/if}

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
	}

	.toolbar :global(.search) {
		flex: 1 1 16rem;
		max-width: 24rem;
	}

	.results {
		margin-top: calc(-1 * var(--space-3));
		color: var(--text-3);
		font-size: var(--text-sm);
	}
</style>
