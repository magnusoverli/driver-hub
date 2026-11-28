<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Download from '@lucide/svelte/icons/download';
	import Plus from '@lucide/svelte/icons/plus';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getApi } from '#lib/api/context.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { Acquisitions } from '#lib/catalog/acquisitions.svelte.js';
	import { catalogDrivers, setupPath, type DriverVersion } from '#lib/catalog/drivers.js';
	import DriverOverview from '#lib/catalog/DriverOverview.svelte';
	import {
		catalogKeys,
		publishedQuery,
		retainedQuery,
		type RetainedRelease
	} from '#lib/catalog/queries.js';
	import RemoveReleaseDialog from '#lib/catalog/RemoveReleaseDialog.svelte';
	import ConditionLabel from '#lib/deployments/ConditionLabel.svelte';
	import { freshObservations } from '#lib/deployments/observations.svelte.js';
	import { deploymentsQuery } from '#lib/deployments/queries.js';
	import { deviceName, sortByName } from '#lib/deployments/view.js';
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
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import Table from '#lib/ui/Table.svelte';

	const api = getApi();
	const session = getSession();
	const client = useQueryClient();
	// Outcomes of actions that led here, such as removing a version on its own page.
	const notices = getNotices().take('/(app)/catalog/[driverId]');

	const driverId = $derived(page.params.driverId ?? '');
	let prerelease = $state(false);
	let removing = $state<RetainedRelease | null>(null);
	let removeOpen = $state(false);

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
	const completed = $derived(
		(operations.data ?? [])
			.filter((op) => op.state === 'succeeded')
			.map((op) => op.id)
			.join()
	);
	$effect(() => {
		if (completed) void client.invalidateQueries({ queryKey: catalogKeys.retained() });
	});

	const sorted = $derived(
		sortByName((deployments.data ?? []).filter((device) => device.driverId === driverId))
	);
	const readDevices = freshObservations(() => sorted);
	const devices = $derived(readDevices());
	const driver = $derived(
		catalogDrivers({
			published: (published.data ?? []).filter((release) => release.driverId === driverId),
			retained: (retained.data ?? []).filter((release) => release.driverId === driverId),
			downloading: (operations.data ?? []).flatMap((op) =>
				op.kind === 'retain' && op.state === 'running' && op.target?.driverId && op.target.version
					? [{ driverId: op.target.driverId, version: op.target.version }]
					: []
			),
			devices
		})[0]
	);
	const loaded = $derived(
		retained.data !== undefined && (published.data !== undefined || published.error !== null)
	);

	const releasePage = (version: string) =>
		resolve('/(app)/catalog/[driverId]/[version]', { driverId, version });

	const setUp = (release: RetainedRelease) => setupPath(resolve('/(app)/devices/new'), release);

	function download(version: DriverVersion) {
		void acquisitions.start({ driverId, version: version.version });
	}

	function channel(version: DriverVersion): string {
		if (version.custom) return m.catalog_customer();
		return version.prerelease ? m.catalog_prerelease() : m.catalog_stable();
	}

	function removed() {
		if (removing) {
			acquisitions.tell(m.release_removed({ driver: driverId, version: removing.version }));
		}
		void client.invalidateQueries({ queryKey: catalogKeys.all });
	}
</script>

<a class="back" href={resolve('/(app)/catalog')}>
	<ArrowLeft size={15} aria-hidden="true" />
	{m.nav_catalog()}
</a>

{#if retained.error}
	<PageHeader title={driverId} />
	<Callout tone="fail" title={errorMessage(retained.error)} live />
{:else if !loaded}
	<PageHeader title={driverId} />
	<Card><Loading label={m.catalog_loading()} /></Card>
{:else if !driver}
	<PageHeader title={m.driver_not_found_title()} />
	<Card>
		<EmptyState icon={SearchX} title={m.driver_not_found_title()}>
			<p>{m.driver_not_found_body({ driver: driverId })}</p>
		</EmptyState>
	</Card>
{:else}
	{@const latest = driver.latest}
	{@const ready = driver.newestDownloaded}
	<PageHeader title={driver.name} description={driver.driverId}>
		{#snippet actions()}
			{#if latest.state === 'available' && latest.published && session.isAdmin}
				<Button
					variant={ready ? 'secondary' : 'primary'}
					icon={Download}
					busy={acquisitions.submitting}
					onclick={() => download(latest)}
				>
					{m.driver_download_version({ version: latest.version })}
				</Button>
			{/if}
			{#if ready?.retained && clusterReady}
				{@const release = ready.retained}
				<Button variant="primary" icon={Plus} href={setUp(release)}>
					{ready === latest
						? m.catalog_stage()
						: m.catalog_stage_version({ version: ready.version })}
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#each notices as item, index (index)}
		<Callout tone={item.tone} title={item.title} live>{item.body}</Callout>
	{/each}
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
			{errorMessage(published.error)}
		</Callout>
	{/if}

	<DriverOverview
		release={{ driverId, version: (ready ?? latest).version }}
		downloaded={ready !== undefined}
	/>

	<div class="layout">
		<Card title={m.driver_versions_title()} flush>
			{#snippet actions()}
				<Checkbox bind:checked={prerelease}>{m.catalog_include_pre()}</Checkbox>
			{/snippet}
			<Table label={m.driver_versions_title()}>
				<thead>
					<tr>
						<th scope="col">{m.catalog_version()}</th>
						<th scope="col">{m.catalog_channel()}</th>
						<th scope="col">{m.catalog_availability()}</th>
						<th scope="col">{m.catalog_devices()}</th>
						<th scope="col"><span class="visually-hidden">{m.users_column_actions()}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each driver.versions as version (version.version)}
						<tr>
							<td>
								<a class="version-link mono" href={releasePage(version.version)}>
									{version.version}
								</a>
							</td>
							<td>{channel(version)}</td>
							<td>
								{#if version.state === 'downloaded'}
									<Badge tone="ok">{m.catalog_downloaded()}</Badge>
								{:else if version.state === 'downloading'}
									<Badge tone="accent">{m.catalog_downloading()}</Badge>
								{:else}
									<Badge>{m.catalog_published_only()}</Badge>
								{/if}
							</td>
							<td>
								{#if version.devices}<span class="mono">{version.devices}</span>
								{:else}<span class="none">—</span>{/if}
							</td>
							<td>
								<span class="row-actions">
									{#if version.retained}
										{@const release = version.retained}
										{#if clusterReady}
											<Button size="sm" href={setUp(release)}>{m.catalog_stage()}</Button>
										{/if}
										{#if session.isAdmin}
											<IconButton
												size="sm"
												icon={Trash2}
												label={m.release_remove_label({
													name: release.displayName,
													version: release.version
												})}
												onclick={() => {
													removing = release;
													removeOpen = true;
												}}
											/>
										{/if}
									{:else if version.state === 'available' && version.published && session.isAdmin}
										<Button
											size="sm"
											disabled={acquisitions.submitting}
											onclick={() => download(version)}
										>
											{m.catalog_download()}
										</Button>
									{/if}
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		</Card>

		<Card title={m.driver_devices_title()} flush>
			{#if !clusterReady}
				<p class="panel">{m.driver_devices_no_cluster()}</p>
			{:else if deployments.error}
				<p class="panel">{errorMessage(deployments.error)}</p>
			{:else if !deployments.data}
				<Loading label={m.devices_loading()} />
			{:else if devices.length}
				<ul class="devices">
					{#each devices as device (device.nodeId)}
						<li>
							<a href={resolve('/(app)/devices/[nodeId]', { nodeId: device.nodeId })}>
								{deviceName(device)}
							</a>
							<span class="mono version">{device.version}</span>
							<ConditionLabel input={device} />
						</li>
					{/each}
				</ul>
			{:else}
				<p class="panel">{m.driver_no_devices()}</p>
			{/if}
		</Card>
	</div>
{/if}

{#if removing && session.isAdmin}
	<RemoveReleaseDialog bind:open={removeOpen} release={removing} onRemoved={removed} />
{/if}

<style>
	.back {
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
		gap: var(--space-2);
		margin-bottom: calc(-1 * var(--space-3));
		color: var(--text-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		text-decoration: none;
	}

	.back:hover {
		color: var(--text);
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(18rem, 1fr);
		align-items: start;
		gap: var(--space-5);
	}

	@media (max-width: 68rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.version-link {
		color: var(--text);
		font-weight: var(--weight-medium);
		text-decoration: none;
	}

	.version-link:hover {
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

	.panel {
		padding: var(--space-4);
		color: var(--text-2);
	}

	.devices {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.devices li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-3) var(--space-4);
	}

	.devices li + li {
		border-top: 1px solid var(--border);
	}

	.devices a {
		font-weight: var(--weight-semibold);
		text-decoration: none;
	}

	.devices a:hover {
		text-decoration: underline;
	}

	.version {
		color: var(--text-3);
		font-size: var(--text-sm);
		justify-self: end;
	}

	.devices :global(.condition) {
		grid-column: 1 / -1;
	}
</style>
