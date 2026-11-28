<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import History from '@lucide/svelte/icons/history';
	import Upload from '@lucide/svelte/icons/upload';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { Acquisitions } from '#lib/catalog/acquisitions.svelte.js';
	import BuildDialog from '#lib/catalog/BuildDialog.svelte';
	import { catalogDrivers, matchesDriver, type Driver } from '#lib/catalog/drivers.js';
	import ImportDialog from '#lib/catalog/ImportDialog.svelte';
	import {
		catalogKeys,
		publishedQuery,
		retainedQuery,
		type BuildInput,
		type Identity,
		type RetainedRelease
	} from '#lib/catalog/queries.js';
	import StageDialog from '#lib/catalog/StageDialog.svelte';
	import { deploymentsQuery } from '#lib/deployments/queries.js';
	import { operationsQuery } from '#lib/operations/operations.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { getNotices } from '#lib/shell/notices.js';
	import { capabilitiesQuery } from '#lib/system/queries.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import FilterTabs from '#lib/ui/FilterTabs.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Table from '#lib/ui/Table.svelte';

	const FILTERS = ['all', 'downloaded', 'available'] as const;
	type Filter = (typeof FILTERS)[number];

	const api = getApi();
	const session = getSession();
	const client = useQueryClient();
	const notices = getNotices().take('/(app)/catalog');

	let prerelease = $state(false);
	let search = $state('');
	let filter = $state<Filter>('all');
	let staging = $state<RetainedRelease | null>(null);
	let stageOpen = $state(false);
	let importOpen = $state(false);
	let buildOpen = $state(false);

	const caps = createQuery(() => capabilitiesQuery(api));
	const clusterReady = $derived(caps.data?.nomadConfigured === true);
	const published = createQuery(() => publishedQuery(api, prerelease));
	const retained = createQuery(() => retainedQuery(api));
	const deployments = createQuery(() => ({ ...deploymentsQuery(api), enabled: clusterReady }));
	const operations = createQuery(() => ({
		...operationsQuery(api),
		enabled: caps.data?.asyncAcquisition === true
	}));
	const acquisitions = new Acquisitions({
		api,
		client,
		operations: () => operations.data,
		background: () => caps.data?.asyncAcquisition === true
	});

	// A finished download or build adds a downloaded release.
	const completed = $derived(
		(operations.data ?? [])
			.filter((op) => op.state === 'succeeded')
			.map((op) => op.id)
			.join()
	);
	$effect(() => {
		if (completed) void client.invalidateQueries({ queryKey: catalogKeys.retained() });
	});
	const running = $derived((operations.data ?? []).filter((op) => op.state === 'running'));
	const building = $derived(running.some((op) => op.kind === 'build'));

	const drivers = $derived(
		catalogDrivers({
			published: published.data ?? [],
			retained: retained.data ?? [],
			downloading: running.flatMap((op) =>
				op.kind === 'retain' && op.target?.driverId && op.target.version
					? [{ driverId: op.target.driverId, version: op.target.version }]
					: []
			),
			devices: deployments.data ?? []
		})
	);
	const matchesFilter = (driver: Driver, value: Filter) =>
		value === 'all' || (value === 'downloaded') === (driver.newestDownloaded !== undefined);
	const rows = $derived(
		drivers.filter((driver) => matchesFilter(driver, filter) && matchesDriver(driver, search))
	);
	const filterLabels: Record<Filter, () => string> = {
		all: m.catalog_filter_all,
		downloaded: m.catalog_filter_downloaded,
		available: m.catalog_filter_available
	};
	const filterItems = $derived(
		FILTERS.map((value) => ({
			value,
			label: filterLabels[value](),
			count: drivers.filter((driver) => matchesFilter(driver, value)).length
		}))
	);
	const loaded = $derived(
		retained.data !== undefined && (published.data !== undefined || published.error !== null)
	);

	const driverPage = (driverId: string) => resolve('/(app)/catalog/[driverId]', { driverId });

	function setUp(release: RetainedRelease) {
		staging = release;
		stageOpen = true;
	}

	function imported({ driverId, version }: Identity) {
		search = '';
		filter = 'all';
		acquisitions.tell(m.catalog_import_done({ driver: driverId, version }));
		void client.invalidateQueries({ queryKey: catalogKeys.retained() });
	}
</script>

<PageHeader title={m.nav_catalog()} description={m.catalog_description()}>
	{#snippet actions()}
		<Button variant="ghost" icon={History} href={resolve('/(app)/activity')}>
			{m.catalog_history()}
			{#if running.length}<Badge tone="accent">{running.length}</Badge>{/if}
		</Button>
		{#if session.isAdmin}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props}>
							{m.catalog_add_custom()}
							<ChevronDown size={15} aria-hidden="true" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content class="menu-content" align="end" sideOffset={6}>
						<DropdownMenu.Item
							class="menu-item"
							onSelect={() => {
								acquisitions.clear();
								importOpen = true;
							}}
						>
							<Upload size={15} aria-hidden="true" />
							{m.catalog_import()}
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="menu-item"
							disabled={!caps.data?.buildsEnabled}
							onSelect={() => (buildOpen = true)}
						>
							<GitBranch size={15} aria-hidden="true" />
							<span class="menu-text">
								{m.catalog_build_menu()}
								{#if !caps.data?.buildsEnabled}
									<small>{m.catalog_build_off_short()}</small>
								{/if}
							</span>
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		{/if}
	{/snippet}
</PageHeader>

{#each notices as item, index (index)}
	<Callout tone={item.tone} title={item.title} live>{item.body}</Callout>
{/each}
{#if caps.error}
	<Callout tone="warn" title={errorMessage(caps.error)} live>
		<Button size="sm" onclick={() => caps.refetch()}>{m.common_retry()}</Button>
	</Callout>
{/if}
{#if operations.error}
	<Callout tone="warn" title={errorMessage(operations.error)} live>
		<Button size="sm" onclick={() => operations.refetch()}>{m.common_retry()}</Button>
	</Callout>
{/if}
{#if acquisitions.problem}
	<Callout tone="fail" title={acquisitions.problem} live />
{:else if acquisitions.outcome}
	{@const outcome = acquisitions.outcome}
	<Callout tone={outcome.tone} title={outcome.title} live>
		{#if outcome.body}<p>{outcome.body}</p>{/if}
		<a href={resolve('/(app)/activity')}>{m.catalog_all_activity()}</a>
	</Callout>
{:else if acquisitions.notice}
	<Callout title={acquisitions.notice} live />
{/if}
{#if published.error}
	<Callout tone="warn" title={m.catalog_published_error()} live>
		<p>{errorMessage(published.error)}</p>
		<Button size="sm" onclick={() => published.refetch()}>{m.common_retry()}</Button>
	</Callout>
{/if}

<Card flush>
	<div class="toolbar">
		<SearchField
			class="search"
			label={m.catalog_search()}
			placeholder={m.catalog_search()}
			bind:value={search}
		/>
		<FilterTabs label={m.catalog_filter_label()} items={filterItems} bind:value={filter} />
		<Checkbox bind:checked={prerelease}>{m.catalog_include_pre()}</Checkbox>
		<Button
			size="sm"
			variant="ghost"
			onclick={() => Promise.all([published.refetch(), retained.refetch()])}
			busy={published.isFetching || retained.isFetching}
		>
			{m.catalog_refresh()}
		</Button>
	</div>
	{#if retained.error}
		<div class="panel"><Callout tone="fail" title={errorMessage(retained.error)} live /></div>
	{:else if !loaded}
		<Loading label={m.catalog_loading()} />
	{:else if rows.length}
		<Table label={m.catalog_drivers()}>
			<thead>
				<tr>
					<th scope="col">{m.catalog_column_driver()}</th>
					<th scope="col">{m.catalog_latest()}</th>
					<th scope="col">{m.catalog_availability()}</th>
					<th scope="col">{m.catalog_devices()}</th>
					<th scope="col"><span class="visually-hidden">{m.users_column_actions()}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as driver (driver.driverId)}
					{@const latest = driver.latest}
					{@const ready = driver.newestDownloaded}
					<tr>
						<td>
							<a class="driver-link" href={driverPage(driver.driverId)}>{driver.name}</a>
							{#if driver.name !== driver.driverId}
								<small class="mono">{driver.driverId}</small>
							{/if}
						</td>
						<td>
							<span class="mono">{latest.version}</span>
							{#if driver.versions.length > 1}
								<small>{m.catalog_version_count({ count: driver.versions.length })}</small>
							{/if}
						</td>
						<td>
							<span class="availability">
								{#if latest.state === 'downloaded'}
									<Badge tone="ok">{m.catalog_downloaded()}</Badge>
								{:else if latest.state === 'downloading'}
									<Badge tone="accent">{m.catalog_downloading()}</Badge>
								{:else}
									<Badge>{m.catalog_published_only()}</Badge>
								{/if}
								{#if driver.custom}<Badge>{m.catalog_custom()}</Badge>{/if}
							</span>
							{#if ready && ready !== latest}
								<small>{m.catalog_other_downloaded({ version: ready.version })}</small>
							{/if}
						</td>
						<td>
							{#if driver.devices}
								<span class="mono">{driver.devices}</span>
							{:else}
								<span class="none">—</span>
							{/if}
						</td>
						<td>
							<span class="row-actions">
								{#if latest.state === 'available' && latest.published && session.isAdmin && caps.data}
									<Button
										size="sm"
										disabled={acquisitions.submitting}
										onclick={() =>
											acquisitions.start({ driverId: driver.driverId, version: latest.version })}
									>
										{m.catalog_download()}
									</Button>
								{/if}
								{#if ready?.retained && clusterReady}
									{@const release = ready.retained}
									<Button
										size="sm"
										variant={latest.state === 'downloaded' ? 'primary' : 'secondary'}
										onclick={() => setUp(release)}
									>
										{ready === latest
											? m.catalog_stage()
											: m.catalog_stage_version({ version: ready.version })}
									</Button>
								{/if}
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{:else}
		<p class="empty">
			{drivers.length
				? m.catalog_no_match()
				: published.error
					? m.catalog_empty_retained()
					: m.catalog_empty_published()}
		</p>
	{/if}
</Card>

{#if importOpen && session.isAdmin}
	<ImportDialog bind:open={importOpen} onImported={imported} />
{/if}
{#if buildOpen && session.isAdmin}
	<BuildDialog
		bind:open={buildOpen}
		busy={acquisitions.submitting || building}
		submit={(input: BuildInput) => acquisitions.start(input)}
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
		max-width: 22rem;
	}

	.empty,
	.panel {
		padding: var(--space-4);
		color: var(--text-2);
	}

	small {
		display: block;
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	.availability {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}

	.driver-link {
		color: var(--text);
		font-weight: var(--weight-semibold);
		text-decoration: none;
	}

	.driver-link:hover {
		text-decoration: underline;
	}

	.none {
		color: var(--text-3);
	}

	.row-actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: var(--space-2);
	}

	.menu-text {
		display: flex;
		flex-direction: column;
	}

	.menu-text small {
		font-size: var(--text-xs);
	}
</style>
