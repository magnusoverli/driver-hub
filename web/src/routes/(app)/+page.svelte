<script lang="ts">
	import { untrack } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import SearchX from '@lucide/svelte/icons/search-x';
	import { createQuery } from '@tanstack/svelte-query';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getApi } from '#lib/api/context.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { retainedQuery, type RetainedRelease } from '#lib/catalog/queries.js';
	import StageDialog from '#lib/catalog/StageDialog.svelte';
	import AddDeviceDialog from '#lib/deployments/AddDeviceDialog.svelte';
	import DeploymentTable from '#lib/deployments/DeploymentTable.svelte';
	import { freshObservations } from '#lib/deployments/observations.svelte.js';
	import { deploymentsQuery, updatesQuery } from '#lib/deployments/queries.js';
	import StatusLegend from '#lib/deployments/StatusLegend.svelte';
	import StatusTiles from '#lib/deployments/StatusTiles.svelte';
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
	import {
		capabilitiesQuery,
		imageDistributionQuery,
		nomadConnectionQuery
	} from '#lib/system/queries.js';
	import { siteReadiness } from '#lib/system/readiness.js';
	import SetupChecklist, { type SetupStep } from '#lib/system/SetupChecklist.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';

	const api = getApi();
	const session = getSession();
	// Outcomes of actions that led here, such as deleting a device.
	const notices = getNotices().take('/(app)');
	const capabilities = createQuery(() => capabilitiesQuery(api));
	const nomad = createQuery(() => nomadConnectionQuery(api));
	const images = createQuery(() => imageDistributionQuery(api));
	// Without a cluster the manager has no devices to list and answers 503.
	const cluster = $derived(capabilities.data?.nomadConfigured === true);
	const deployments = createQuery(() => ({ ...deploymentsQuery(api), enabled: cluster }));
	const updates = createQuery(() => ({ ...updatesQuery(api), enabled: cluster }));
	const retained = createQuery(() => retainedQuery(api));

	const readiness = $derived(
		siteReadiness({
			capabilities: capabilities.data,
			nomad: nomad.data,
			nomadError: nomad.error,
			images: images.data,
			imagesError: images.error
		})
	);
	const problems = $derived(readiness.filter((item) => item.state === 'attention'));

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
			void replaceState(`${resolve('/(app)')}${next}`, page.state);
		});
	});

	const sorted = $derived(sortByName(deployments.data ?? []));
	const readRows = freshObservations(() => sorted);
	const rows = $derived(readRows());
	const hints = $derived(updateHints(rows, updates.data ?? [], retained.data ?? []));
	const visible = $derived(
		rows.filter((row) => matchesFilter(row, filter, hints) && matchesSearch(row, search))
	);
	const tileLabels: Record<DeploymentFilter, () => string> = {
		all: m.devices_tile_all,
		attention: m.devices_filter_attention,
		running: m.devices_filter_running,
		stopped: m.devices_filter_stopped,
		updates: m.devices_filter_updates
	};
	const tiles = $derived(
		DEPLOYMENT_FILTERS.map((value) => ({
			value,
			label: tileLabels[value](),
			count: rows.filter((row) => matchesFilter(row, value, hints)).length,
			alert: value === 'attention'
		}))
	);

	// A site without devices yet is walked through the steps from cluster to first device.
	const firstRun = $derived(
		capabilities.data !== undefined &&
			(!cluster || (deployments.data !== undefined && !rows.length))
	);
	const downloaded = $derived((retained.data?.length ?? 0) > 0);
	const canAdd = $derived(session.isAdmin && cluster);

	let chooserOpen = $state(false);
	let staging = $state<RetainedRelease | null>(null);
	let stageOpen = $state(false);

	function addDevice() {
		chooserOpen = true;
	}

	const steps = $derived<SetupStep[]>([
		{
			id: 'nomad',
			title: m.setup_nomad_title(),
			detail: m.setup_nomad_detail(),
			done: cluster && nomad.data?.state === 'connected',
			action: session.isAdmin
				? { label: m.setup_nomad_action(), href: resolve('/(app)/settings/nomad') }
				: undefined
		},
		{
			id: 'videoipath',
			title: m.setup_videoipath_title(),
			detail: m.setup_videoipath_detail(),
			done: capabilities.data?.videoIPathConfigured === true,
			action: session.isAdmin
				? { label: m.setup_videoipath_action(), href: resolve('/(app)/settings/videoipath') }
				: undefined
		},
		{
			id: 'download',
			title: m.setup_download_title(),
			detail: m.setup_download_detail(),
			done: downloaded,
			action: { label: m.setup_download_action(), href: resolve('/(app)/catalog') }
		},
		{
			id: 'device',
			title: m.setup_device_title(),
			detail: m.setup_device_detail(),
			done: rows.length > 0,
			action: session.isAdmin
				? { label: m.devices_add(), onclick: addDevice, disabled: !cluster || !downloaded }
				: undefined
		}
	]);

	function clearFilters() {
		search = '';
		filter = 'all';
	}
</script>

<PageHeader title={m.devices_title()} description={m.devices_description()}>
	{#snippet actions()}
		{#if canAdd}
			<Button variant="primary" icon={Plus} onclick={addDevice}>{m.devices_add()}</Button>
		{/if}
	{/snippet}
</PageHeader>

{#each notices as notice, index (index)}
	<Callout tone={notice.tone} title={notice.title} live>{notice.body}</Callout>
{/each}

{#if capabilities.error}
	<Callout tone="fail" title={m.devices_error_title()} live>
		{errorMessage(capabilities.error)}
	</Callout>
{:else if !capabilities.data}
	<Card><Loading label={m.devices_loading()} /></Card>
{:else if firstRun}
	<Card title={m.setup_title()} description={m.setup_description()} flush>
		<SetupChecklist {steps} />
		{#if !session.isAdmin}<p class="viewer-note">{m.setup_viewer_note()}</p>{/if}
	</Card>
{:else}
	{#if problems.length}
		<Callout tone="warn" title={m.devices_site_attention({ count: problems.length })}>
			<ul class="problems">
				{#each problems as item (item.id)}
					<li><strong>{item.label}:</strong> {item.detail}</li>
				{/each}
			</ul>
			{#if session.isAdmin}
				<a href={resolve('/(app)/settings')}>{m.devices_open_site_setup()}</a>
			{:else}
				<p>{m.devices_site_attention_viewer()}</p>
			{/if}
		</Callout>
	{/if}

	{#if deployments.error && !deployments.data}
		<Callout tone="fail" title={m.devices_error_title()} live>
			<p>{errorMessage(deployments.error)}</p>
		</Callout>
		<div>
			<Button onclick={() => deployments.refetch()} busy={deployments.isFetching}>
				{m.common_retry()}
			</Button>
		</div>
	{:else if !deployments.data}
		<Card><Loading label={m.devices_loading()} /></Card>
	{:else}
		{#if deployments.error}
			<Callout tone="warn" title={m.deployments_stale_title()} live>
				{m.deployments_stale_body({ detail: errorMessage(deployments.error) })}
			</Callout>
		{/if}
		<StatusTiles label={m.devices_filter_label()} items={tiles} bind:value={filter} />
		<Card flush>
			<div class="toolbar">
				<SearchField
					class="search"
					label={m.deployments_search_label()}
					placeholder={m.deployments_search_placeholder()}
					bind:value={search}
				/>
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
		<div class="below">
			<p class="results" role="status">
				{m.deployments_showing({ shown: visible.length, total: rows.length })}
			</p>
			<StatusLegend />
		</div>
	{/if}
{/if}

{#if canAdd}
	<AddDeviceDialog
		bind:open={chooserOpen}
		onChoose={(release: RetainedRelease) => {
			staging = release;
			stageOpen = true;
		}}
	/>
{/if}
{#if stageOpen && staging}
	<StageDialog bind:open={stageOpen} release={staging} />
{/if}

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
	}

	.toolbar :global(.search) {
		flex: 1 1 14rem;
		max-width: 26rem;
	}

	.below {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: calc(-1 * var(--space-2));
	}

	.results {
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	.problems {
		margin: 0 0 var(--space-2);
		padding-left: var(--space-5);
	}

	.viewer-note {
		padding: 0 var(--space-4) var(--space-4);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
