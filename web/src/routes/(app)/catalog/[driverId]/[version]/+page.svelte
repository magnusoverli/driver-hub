<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Download from '@lucide/svelte/icons/download';
	import Plus from '@lucide/svelte/icons/plus';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getApi } from '#lib/api/context.js';
	import { isApiError } from '#lib/api/errors.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { acquire } from '#lib/catalog/acquire.js';
	import { catalogKeys, releaseQuery } from '#lib/catalog/queries.js';
	import ReleaseInputs from '#lib/catalog/ReleaseInputs.svelte';
	import RemoveReleaseDialog from '#lib/catalog/RemoveReleaseDialog.svelte';
	import { setupPath } from '#lib/catalog/drivers.js';
	import { deploymentsQuery } from '#lib/deployments/queries.js';
	import { deviceName, shortDigest } from '#lib/deployments/view.js';
	import { operationKeys } from '#lib/operations/operations.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { getNotices } from '#lib/shell/notices.js';
	import { capabilitiesQuery } from '#lib/system/queries.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import CopyButton from '#lib/ui/CopyButton.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';

	const api = getApi();
	const session = getSession();
	const queryClient = useQueryClient();
	const notices = getNotices();

	const identity = $derived({
		driverId: page.params.driverId ?? '',
		version: page.params.version ?? ''
	});
	const capabilities = createQuery(() => capabilitiesQuery(api));
	// The copy on this Hub is authoritative; otherwise show what is published upstream.
	const retained = createQuery(() => ({
		...releaseQuery(api, 'retained', identity),
		retry: false
	}));
	const notRetained = $derived(isApiError(retained.error) && retained.error.status === 404);
	const published = createQuery(() => ({
		...releaseQuery(api, 'published', identity),
		enabled: notRetained
	}));
	const release = $derived(retained.data ?? published.data);
	const record = $derived(release?.record);
	const declaration = $derived(release?.configuration);
	const clusterReady = $derived(capabilities.data?.nomadConfigured === true);
	const deployments = createQuery(() => ({
		...deploymentsQuery(api),
		enabled: retained.data !== undefined && capabilities.data?.nomadConfigured === true
	}));
	const running = $derived(
		(deployments.data ?? []).filter(
			(d) => d.driverId === identity.driverId && d.version === identity.version
		)
	);
	const notFound = $derived(
		notRetained && isApiError(published.error) && published.error.status === 404
	);
	const loadError = $derived(
		(!notRetained && retained.error) || (notRetained && !notFound && published.error) || null
	);

	let removeOpen = $state(false);
	let downloading = $state(false);
	let notice = $state<string | null>(null);
	let problem = $state<string | null>(null);

	async function download() {
		downloading = true;
		problem = notice = null;
		try {
			const result = await acquire(api, identity, capabilities.data?.asyncAcquisition === true);
			if (result.kind === 'operation') {
				notice = m.release_download_started();
				void queryClient.invalidateQueries({ queryKey: operationKeys.all });
			} else {
				void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
			}
		} catch (error) {
			problem = errorMessage(error);
		} finally {
			downloading = false;
		}
	}

	async function removed() {
		notices.leave('/(app)/catalog/[driverId]', {
			tone: 'info',
			title: m.release_removed({ driver: identity.driverId, version: identity.version })
		});
		queryClient.removeQueries({ queryKey: catalogKeys.all });
		await goto(resolve('/(app)/catalog/[driverId]', { driverId: identity.driverId }));
	}

	const github = 'https://github.com/VideoIPath/VideoIPath_External_Drivers/tree';
</script>

<a class="back" href={resolve('/(app)/catalog/[driverId]', { driverId: identity.driverId })}>
	<ArrowLeft size={15} aria-hidden="true" />
	{m.release_back_to_driver()}
</a>

{#if notFound}
	<PageHeader title={m.release_not_found_title()} />
	<Card>
		<EmptyState icon={SearchX} title={m.release_not_found_title()}>
			<p>{m.release_not_found_body(identity)}</p>
		</EmptyState>
	</Card>
{:else if loadError}
	<PageHeader title={m.release_title()} />
	<Callout tone="fail" title={m.release_error_title()} live>{errorMessage(loadError)}</Callout>
{:else if !release || !record || !declaration}
	<PageHeader title={m.release_title()} />
	<Card><Loading label={m.catalog_loading()} /></Card>
{:else}
	<PageHeader
		title={record.displayName}
		description={m.deployment_driver_line({ driver: record.driverId, version: record.version })}
	>
		{#snippet actions()}
			{#if retained.data}
				{#if clusterReady}
					<Button
						variant="primary"
						icon={Plus}
						href={setupPath(resolve('/(app)/devices/new'), identity)}
					>
						{m.catalog_stage()}
					</Button>
				{/if}
				{#if session.isAdmin}
					<Button icon={Trash2} onclick={() => (removeOpen = true)}>
						{m.release_remove_action()}
					</Button>
				{/if}
			{:else if session.isAdmin}
				<Button variant="primary" icon={Download} busy={downloading} onclick={download}>
					{m.catalog_download()}
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if notice}
		<Callout title={notice} live>
			<a href={resolve('/(app)/activity')}>{m.catalog_all_activity()}</a>
		</Callout>
	{/if}
	{#if problem}<Callout tone="fail" title={problem} live />{/if}
	{#if !retained.data}
		<Callout title={m.release_published_only_title()}>{m.release_published_only_body()}</Callout>
	{/if}

	<div class="layout">
		<div class="column">
			<Card title={m.release_inputs_title()} description={m.release_inputs_description()} flush>
				<ReleaseInputs {declaration} />
			</Card>
			<Card title={m.release_monitoring_title()}>
				{#if declaration.controlHealth}
					<p>
						{m.release_control_check({
							path: declaration.controlHealth.path,
							port: declaration.controlHealth.port
						})}
					</p>
				{:else}
					<Callout tone="warn" title={m.release_no_control_check_title()}>
						{m.release_no_control_check_body()}
					</Callout>
				{/if}
			</Card>
		</div>
		<div class="column">
			<Card title={m.release_facts_title()}>
				<Facts>
					<dt>{m.facts_driver()}</dt>
					<dd><code>{record.driverId}</code></dd>
					<dt>{m.facts_version()}</dt>
					<dd><span class="mono">{record.version}</span></dd>
					<dt>{m.catalog_origin()}</dt>
					<dd>
						<Badge tone={record.origin === 'customer' ? 'neutral' : 'accent'}>
							{record.origin === 'customer' ? m.catalog_customer() : m.catalog_maintainer()}
						</Badge>
						<!-- Customer releases are imported or built here; only published ones are downloaded. -->
						{#if retained.data && record.origin !== 'customer'}
							<Badge>{m.catalog_downloaded()}</Badge>
						{/if}
					</dd>
					{#if record.source?.commit}
						<dt>{m.catalog_commit()}</dt>
						<dd>
							{#if record.source.directory}
								<!-- eslint-disable svelte/no-navigation-without-resolve -- the public repository, not an app route -->
								<a
									href={`${github}/${record.source.commit}/${record.source.directory}`}
									rel="noreferrer"
									target="_blank"
								>
									<code>{record.source.commit.slice(0, 12)}</code>
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{:else}
								<code>{record.source.commit.slice(0, 12)}</code>
							{/if}
						</dd>
					{/if}
					{#if record.source?.directory}
						<dt>{m.catalog_directory()}</dt>
						<dd><code>{record.source.directory}</code></dd>
					{/if}
					<dt>{m.catalog_digest()}</dt>
					<dd>
						<span class="with-copy">
							<code title={record.image.digest}>{shortDigest(record.image.digest)}</code>
							<CopyButton value={record.image.digest} label={m.release_copy_digest()} />
						</span>
					</dd>
					<dt>{m.catalog_platform()}</dt>
					<dd><code>{record.image.platforms.join(', ')}</code></dd>
				</Facts>
			</Card>
			{#if retained.data && capabilities.data?.nomadConfigured}
				<Card title={m.release_used_by_title()}>
					{#if running.length}
						<ul class="devices">
							{#each running as device (device.nodeId)}
								<li>
									<a href={resolve('/(app)/devices/[nodeId]', { nodeId: device.nodeId })}>
										{deviceName(device)}
									</a>
								</li>
							{/each}
						</ul>
					{:else if deployments.data}
						<p class="note">{m.release_used_by_none()}</p>
					{:else}
						<Loading label={m.deployments_loading()} />
					{/if}
				</Card>
			{/if}
		</div>
	</div>

	{#if session.isAdmin && retained.data}
		<RemoveReleaseDialog
			bind:open={removeOpen}
			release={{ ...identity, displayName: record.displayName, origin: record.origin }}
			onRemoved={removed}
		/>
	{/if}
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
		grid-template-columns: minmax(0, 2fr) minmax(19rem, 1fr);
		align-items: start;
		gap: var(--space-5);
	}

	@media (max-width: 68rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}

	.with-copy {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.devices {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding-left: var(--space-5);
	}

	.note {
		color: var(--text-2);
	}
</style>
