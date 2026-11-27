<script lang="ts">
	import Activity from '@lucide/svelte/icons/activity';
	import SearchX from '@lucide/svelte/icons/search-x';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { catalogKeys } from '#lib/catalog/queries.js';
	import {
		matchesOperationFilter,
		OPERATION_FILTERS,
		operationsQuery,
		type OperationFilter
	} from '#lib/operations/operations.js';
	import OperationsTable from '#lib/operations/OperationsTable.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { POLL_INTERVAL_MS } from '#lib/query/client.js';
	import { capabilitiesQuery } from '#lib/system/queries.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import FilterTabs from '#lib/ui/FilterTabs.svelte';
	import Freshness from '#lib/ui/Freshness.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';

	const api = getApi();
	const queryClient = useQueryClient();
	const capabilities = createQuery(() => capabilitiesQuery(api));
	const available = $derived(capabilities.data?.asyncAcquisition === true);
	// Polled while open, so work another operator starts shows up too.
	const operations = createQuery(() => ({
		...operationsQuery(api, POLL_INTERVAL_MS),
		enabled: available
	}));

	let filter = $state<OperationFilter>('all');
	const all = $derived(operations.data ?? []);
	const visible = $derived(all.filter((operation) => matchesOperationFilter(operation, filter)));
	const filterLabels: Record<OperationFilter, () => string> = {
		all: m.activity_filter_all,
		running: m.activity_filter_running,
		problems: m.activity_filter_problems,
		succeeded: m.activity_filter_succeeded
	};
	const filterItems = $derived(
		OPERATION_FILTERS.map((value) => ({
			value,
			label: filterLabels[value](),
			count: all.filter((operation) => matchesOperationFilter(operation, value)).length
		}))
	);
	const interrupted = $derived(all.filter((operation) => operation.state === 'interrupted').length);

	// A finished download or build adds a retained release; show it wherever releases are listed.
	const finished = $derived(
		all
			.filter((operation) => operation.state === 'succeeded')
			.map((operation) => operation.id)
			.join()
	);
	$effect(() => {
		if (finished) void queryClient.invalidateQueries({ queryKey: catalogKeys.retained() });
	});
</script>

<PageHeader title={m.nav_activity()} description={m.activity_description()}>
	{#snippet meta()}
		{#if available}
			<Freshness updatedAt={operations.dataUpdatedAt} fetching={operations.isFetching} />
		{/if}
	{/snippet}
</PageHeader>

{#if capabilities.error}
	<Callout tone="fail" title={m.activity_error_title()} live>{capabilities.error.message}</Callout>
{:else if !capabilities.data}
	<Card><Loading label={m.activity_loading()} /></Card>
{:else if !available}
	<Card>
		<EmptyState icon={Activity} title={m.activity_unavailable_title()}>
			<p>{m.activity_unavailable_body()}</p>
		</EmptyState>
	</Card>
{:else if operations.error && !operations.data}
	<Callout tone="fail" title={m.activity_error_title()} live>{operations.error.message}</Callout>
	<div>
		<Button onclick={() => operations.refetch()} busy={operations.isFetching}>
			{m.common_retry()}
		</Button>
	</div>
{:else if !operations.data}
	<Card><Loading label={m.activity_loading()} /></Card>
{:else if all.length === 0}
	<Card>
		<EmptyState icon={Activity} title={m.activity_empty_title()}>
			<p>{m.activity_empty_body()}</p>
			{#snippet actions()}
				<Button href={resolve('/(app)/catalog')}>{m.activity_open_catalog()}</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else}
	{#if operations.error}
		<Callout tone="warn" title={m.deployments_stale_title()} live>
			{m.deployments_stale_body({ detail: operations.error.message })}
		</Callout>
	{/if}
	{#if interrupted}
		<Callout tone="warn" title={m.activity_interrupted_title({ count: interrupted })}>
			{m.activity_interrupted_body()}
		</Callout>
	{/if}
	<Card flush>
		<div class="toolbar">
			<FilterTabs label={m.activity_filter_label()} items={filterItems} bind:value={filter} />
		</div>
		{#if visible.length}
			<OperationsTable operations={visible} label={m.activity_table_label()} />
		{:else}
			<EmptyState icon={SearchX} title={m.activity_no_match_title()}>
				{#snippet actions()}
					<Button onclick={() => (filter = 'all')}>{m.activity_show_all()}</Button>
				{/snippet}
			</EmptyState>
		{/if}
	</Card>
	<p class="footnote">{m.activity_footnote()}</p>
{/if}

<style>
	.toolbar {
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
	}

	.footnote {
		margin-top: calc(-1 * var(--space-2));
		color: var(--text-3);
		font-size: var(--text-sm);
	}
</style>
