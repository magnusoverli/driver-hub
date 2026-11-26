<script lang="ts">
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Upload from '@lucide/svelte/icons/upload';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { acquire } from '#lib/catalog/acquire.js';
	import BuildForm from '#lib/catalog/BuildForm.svelte';
	import ImportDialog from '#lib/catalog/ImportDialog.svelte';
	import RemoveReleaseDialog from '#lib/catalog/RemoveReleaseDialog.svelte';
	import StageDialog from '#lib/catalog/StageDialog.svelte';
	import {
		catalogKeys,
		publishedQuery,
		retainedQuery,
		type BuildInput,
		type Identity,
		type RetainedRelease
	} from '#lib/catalog/queries.js';
	import { deploymentsQuery, updatesQuery } from '#lib/deployments/queries.js';
	import { compareVersions, deviceName, shortId } from '#lib/deployments/view.js';
	import { operationKeys, operationsQuery } from '#lib/operations/operations.js';
	import OperationsTable from '#lib/operations/OperationsTable.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { getNotices } from '#lib/shell/notices.js';
	import { capabilitiesQuery } from '#lib/system/queries.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';

	const TABS = ['published', 'retained', 'updates', 'build'] as const;
	type Tab = (typeof TABS)[number];

	const api = getApi();
	const session = getSession();
	const client = useQueryClient();
	const notices = getNotices().take('/(app)/catalog');

	// The tab lives in the address, so other pages can link to updates or retained releases.
	// Read from the browser's address: after going back, it carries the tab that was last shown.
	const requested = new URL(location.href).searchParams.get('tab');
	let tab = $state<Tab>(TABS.find((value) => value === requested) ?? 'published');
	$effect(() => {
		const query = tab === 'published' ? '' : `?tab=${tab}`;
		if (query !== location.search) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()d path plus query
			void replaceState(`${resolve('/(app)/catalog')}${query}`, {});
		}
	});

	let prerelease = $state(false);
	let search = $state('');
	let staging = $state<RetainedRelease | null>(null);
	let stageOpen = $state(false);
	let removing = $state<RetainedRelease | null>(null);
	let removeOpen = $state(false);
	let importOpen = $state(false);

	const caps = createQuery(() => capabilitiesQuery(api));
	const clusterReady = $derived(
		caps.data?.nomadConfigured === true && caps.data.imageHostConfigured
	);
	const published = createQuery(() => ({
		...publishedQuery(api, prerelease),
		enabled: tab === 'published'
	}));
	const retained = createQuery(() => retainedQuery(api));
	const updates = createQuery(() => ({
		...updatesQuery(api),
		enabled: tab === 'updates' && caps.data?.nomadConfigured === true
	}));
	// Device names for the update suggestions, which identify devices by node ID.
	const deployments = createQuery(() => ({
		...deploymentsQuery(api),
		enabled: tab === 'updates' && caps.data?.nomadConfigured === true
	}));
	const devices = $derived(new Map((deployments.data ?? []).map((d) => [d.nodeId, d])));
	const operations = createQuery(() => ({
		...operationsQuery(api),
		enabled: caps.data?.asyncAcquisition === true
	}));
	// A finished download or build adds a retained release.
	const completed = $derived(
		(operations.data ?? [])
			.filter((op) => op.state === 'succeeded')
			.map((op) => op.id)
			.join()
	);
	$effect(() => {
		if (completed) void client.invalidateQueries({ queryKey: catalogKeys.retained() });
	});

	const same = (a: Identity, b: Identity) => a.driverId === b.driverId && a.version === b.version;
	const inLibrary = (release: Identity) => retained.data?.some((r) => same(r, release));
	const downloading = (release: Identity) =>
		operations.data?.some(
			(op) =>
				op.kind === 'retain' &&
				op.state === 'running' &&
				op.target?.driverId === release.driverId &&
				op.target?.version === release.version
		);
	const building = $derived(
		operations.data?.some((op) => op.kind === 'build' && op.state === 'running') === true
	);
	/** The latest few; the full history with filters is on the Activity page. */
	const recent = $derived((operations.data ?? []).slice(0, 5));

	let submitting = $state(false);
	let problem = $state<string | null>(null);
	let notice = $state<string | null>(null);

	async function start(input: Identity | BuildInput) {
		if (submitting || !session.isAdmin || !caps.data) return;
		submitting = true;
		problem = notice = null;
		try {
			const result = await acquire(api, input, caps.data.asyncAcquisition);
			if (result.kind === 'operation') {
				notice = m.catalog_submitted({ driver: input.driverId });
				await client.invalidateQueries({ queryKey: operationKeys.all });
			} else {
				notice = m.catalog_saved({ driver: input.driverId });
				await client.invalidateQueries({ queryKey: catalogKeys.retained() });
			}
		} catch (error) {
			problem = errorMessage(error);
		} finally {
			submitting = false;
		}
	}

	function removed() {
		if (removing) {
			notice = m.release_removed({ driver: removing.driverId, version: removing.version });
		}
		void client.invalidateQueries({ queryKey: catalogKeys.all });
	}

	const needle = $derived(search.trim().toLowerCase());
	const matches = (release: Identity & { displayName?: string }) =>
		`${release.driverId} ${release.displayName ?? ''} ${release.version}`
			.toLowerCase()
			.includes(needle);
	/** By driver, newest version first, so the versions of one driver read as a group. */
	const byDriver = (a: Identity, b: Identity) =>
		a.driverId.localeCompare(b.driverId) || compareVersions(b.version, a.version);
	const publishedRows = $derived([...(published.data ?? [])].sort(byDriver));
	const retainedRows = $derived([...(retained.data ?? [])].sort(byDriver));
	const releasePage = (release: Identity) =>
		resolve('/(app)/catalog/[driverId]/[version]', {
			driverId: release.driverId,
			version: release.version
		});
</script>

<PageHeader title={m.nav_catalog()} description={m.catalog_description()}>
	{#snippet actions()}
		{#if session.isAdmin}
			<Button
				variant="primary"
				icon={Upload}
				onclick={() => {
					problem = notice = null;
					importOpen = true;
				}}
			>
				{m.catalog_import()}
			</Button>
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
{#if problem}
	<Callout tone="fail" title={problem} live />
{:else if notice}
	<Callout title={notice} live>
		{#if caps.data?.asyncAcquisition}
			<a href={resolve('/(app)/activity')}>{m.catalog_all_activity()}</a>
		{/if}
	</Callout>
{/if}

{#snippet toolbar(remote: boolean, fetching: boolean, refetch: () => unknown)}
	<div class="toolbar">
		<SearchField
			class="search"
			label={m.catalog_search()}
			placeholder={m.catalog_search()}
			bind:value={search}
		/>
		{#if remote}<Checkbox bind:checked={prerelease}>{m.catalog_include_pre()}</Checkbox>{/if}
		<Button size="sm" onclick={refetch} busy={fetching}>{m.catalog_refresh()}</Button>
	</div>
{/snippet}

{#snippet publishedPanel()}
	{@render toolbar(true, published.isFetching, () => published.refetch())}
	{@const rows = publishedRows.filter(matches)}
	{#if published.error}
		<div class="panel"><Callout tone="fail" title={errorMessage(published.error)} live /></div>
	{:else if !published.data}
		<Loading label={m.catalog_loading()} />
	{:else if rows.length}
		<Table label={m.catalog_published()}>
			<thead>
				<tr>
					<th scope="col">{m.catalog_column_driver()}</th>
					<th scope="col">{m.catalog_version()}</th>
					<th scope="col">{m.catalog_channel()}</th>
					<th scope="col">{m.catalog_availability()}</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (`${row.driverId}/${row.version}`)}
					<tr>
						<td><a class="release-link mono" href={releasePage(row)}>{row.driverId}</a></td>
						<td><span class="mono">{row.version}</span></td>
						<td>{row.prerelease ? m.catalog_prerelease() : m.catalog_stable()}</td>
						<td>
							{#if inLibrary(row)}
								{m.catalog_local()}
							{:else if downloading(row)}
								{m.catalog_running()}
							{:else if session.isAdmin && caps.data}
								<Button size="sm" disabled={submitting} onclick={() => start(row)}>
									{m.catalog_download()}
								</Button>
							{:else}
								{m.catalog_published_only()}
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{:else}
		<p class="empty">
			{publishedRows.length ? m.catalog_no_match() : m.catalog_empty_published()}
		</p>
	{/if}
{/snippet}

{#snippet retainedPanel()}
	{@render toolbar(false, retained.isFetching, () => retained.refetch())}
	{@const rows = retainedRows.filter(matches)}
	{#if retained.error}
		<div class="panel"><Callout tone="fail" title={errorMessage(retained.error)} live /></div>
	{:else if !retained.data}
		<Loading label={m.catalog_loading()} />
	{:else if rows.length}
		<Table label={m.catalog_retained()}>
			<thead>
				<tr>
					<th scope="col">{m.catalog_column_driver()}</th>
					<th scope="col">{m.catalog_version()}</th>
					<th scope="col">{m.catalog_origin()}</th>
					<th scope="col"><span class="visually-hidden">{m.users_column_actions()}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (`${row.driverId}/${row.version}`)}
					<tr>
						<td>
							<a class="release-link" href={releasePage(row)}>{row.displayName}</a>
							{#if row.displayName !== row.driverId}<small class="mono">{row.driverId}</small>{/if}
						</td>
						<td><span class="mono">{row.version}</span></td>
						<td>{row.origin === 'customer' ? m.catalog_customer() : m.catalog_maintainer()}</td>
						<td>
							<span class="row-actions">
								{#if clusterReady}
									<Button
										size="sm"
										onclick={() => {
											staging = row;
											stageOpen = true;
										}}
									>
										{m.catalog_stage()}
									</Button>
								{/if}
								{#if session.isAdmin}
									<IconButton
										size="sm"
										icon={Trash2}
										label={m.release_remove_label({ name: row.displayName, version: row.version })}
										onclick={() => {
											removing = row;
											removeOpen = true;
										}}
									/>
								{/if}
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{:else}
		<p class="empty">
			{retainedRows.length ? m.catalog_no_match() : m.catalog_empty_retained()}
		</p>
	{/if}
{/snippet}

{#snippet buildPanel()}
	<div class="panel">
		{#if caps.data?.buildsEnabled && session.isAdmin}
			<p class="intro">{m.catalog_build_hint()}</p>
			<BuildForm busy={submitting || building} submit={start} />
		{:else}
			<p class="intro">{m.catalog_build_off()}</p>
		{/if}
	</div>
{/snippet}

{#snippet updatesPanel()}
	{#if !caps.data?.nomadConfigured}
		<p class="empty">{m.catalog_updates_no_cluster()}</p>
	{:else if updates.error}
		<div class="panel">
			<Callout tone="fail" title={errorMessage(updates.error)} live>
				<Button size="sm" onclick={() => updates.refetch()}>{m.common_retry()}</Button>
			</Callout>
		</div>
	{:else if !updates.data}
		<Loading label={m.catalog_loading()} />
	{:else if !updates.data.length}
		<p class="empty">{m.catalog_no_updates()}</p>
	{:else}
		<Table label={m.catalog_updates()}>
			<thead>
				<tr>
					<th scope="col">{m.catalog_device()}</th>
					<th scope="col">{m.catalog_column_driver()}</th>
					<th scope="col">{m.catalog_installed()}</th>
					<th scope="col">{m.catalog_available()}</th>
				</tr>
			</thead>
			<tbody>
				{#each updates.data as update (update.nodeId)}
					{@const device = devices.get(update.nodeId)}
					<tr>
						<td>
							<a href={resolve('/(app)/deployments/[nodeId]', { nodeId: update.nodeId })}>
								{device ? deviceName(device) : shortId(update.nodeId)}
							</a>
						</td>
						<td><code>{update.driverId}</code></td>
						<td><span class="mono">{update.version}</span></td>
						<td>
							<a
								class="mono"
								href={releasePage({ driverId: update.driverId, version: update.availableVersion })}
							>
								{update.availableVersion}
							</a>
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{/if}
{/snippet}

<Card flush>
	<Tabs
		label={m.nav_catalog()}
		bind:value={() => tab, (value: string) => (tab = value as Tab)}
		tabs={[
			{ value: 'published', label: m.catalog_published(), panel: publishedPanel },
			{ value: 'retained', label: m.catalog_retained(), panel: retainedPanel },
			{ value: 'updates', label: m.catalog_updates(), panel: updatesPanel },
			...(session.isAdmin ? [{ value: 'build', label: m.catalog_builds(), panel: buildPanel }] : [])
		]}
	/>
</Card>

{#if operations.error}
	<Callout tone="warn" title={errorMessage(operations.error)} live>
		<Button size="sm" onclick={() => operations.refetch()}>{m.common_retry()}</Button>
	</Callout>
{:else if recent.length}
	<Card title={m.catalog_recent()} flush>
		{#snippet actions()}
			<a class="all-activity" href={resolve('/(app)/activity')}>{m.catalog_all_activity()}</a>
		{/snippet}
		<OperationsTable operations={recent} label={m.catalog_recent()} />
	</Card>
{/if}

{#if importOpen && session.isAdmin}
	<ImportDialog
		bind:open={importOpen}
		onImported={({ driverId, version }: Identity) => {
			search = '';
			tab = 'retained';
			notice = m.catalog_import_done({ driver: driverId, version });
			void client.invalidateQueries({ queryKey: catalogKeys.retained() });
		}}
	/>
{/if}
{#if stageOpen && staging}
	<StageDialog bind:open={stageOpen} release={staging} />
{/if}
{#if removing && session.isAdmin}
	<RemoveReleaseDialog bind:open={removeOpen} release={removing} onRemoved={removed} />
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

	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.intro {
		max-width: 46rem;
	}

	small {
		display: block;
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	.release-link {
		color: var(--text);
		font-weight: var(--weight-semibold);
		text-decoration: none;
	}

	.release-link.mono {
		font-weight: var(--weight-medium);
	}

	.release-link:hover {
		text-decoration: underline;
	}

	.row-actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: var(--space-2);
	}

	.all-activity {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		text-decoration: none;
	}

	.all-activity:hover {
		text-decoration: underline;
	}
</style>
