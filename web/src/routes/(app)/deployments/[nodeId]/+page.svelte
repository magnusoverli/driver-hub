<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleArrowUp from '@lucide/svelte/icons/circle-arrow-up';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Play from '@lucide/svelte/icons/play';
	import SearchX from '@lucide/svelte/icons/search-x';
	import Square from '@lucide/svelte/icons/square';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getApi } from '#lib/api/context.js';
	import { unwrap } from '#lib/api/client.js';
	import { isApiError } from '#lib/api/errors.js';
	import { retainedQuery } from '#lib/catalog/queries.js';
	import AllocationsTable from '#lib/deployments/AllocationsTable.svelte';
	import DeleteDeploymentDialog from '#lib/deployments/DeleteDeploymentDialog.svelte';
	import DeviceFacts from '#lib/deployments/DeviceFacts.svelte';
	import EvaluationsTable from '#lib/deployments/EvaluationsTable.svelte';
	import HistoryTable from '#lib/deployments/HistoryTable.svelte';
	import type { AppliedChange, Deletion, LifecycleAction } from '#lib/deployments/lifecycle.js';
	import LifecycleDialog from '#lib/deployments/LifecycleDialog.svelte';
	import {
		deploymentKeys,
		deploymentQuery,
		evaluationsQuery,
		historyQuery,
		updatesQuery
	} from '#lib/deployments/queries.js';
	import RenameDialog from '#lib/deployments/RenameDialog.svelte';
	import ConfigurationList from '#lib/deployments/ConfigurationList.svelte';
	import StatusHops from '#lib/deployments/StatusHops.svelte';
	import { secretReferences } from '#lib/deployments/configuration-form.js';
	import { detailStatusInput } from '#lib/deployments/status-path.js';
	import { freshObservations } from '#lib/deployments/observations.svelte.js';
	import { deviceName, updateTargets } from '#lib/deployments/view.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { getNotices } from '#lib/shell/notices.js';
	import { siteKeys } from '#lib/site/settings.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';

	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

	const api = getApi();
	const session = getSession();
	const queryClient = useQueryClient();

	const nodeId = $derived(page.params.nodeId ?? '');
	const validId = $derived(UUID.test(nodeId));
	const detail = createQuery(() => ({ ...deploymentQuery(api, nodeId), enabled: validId }));
	const loaded = $derived(validId && detail.data !== undefined);
	let tab = $state('allocations');
	const history = createQuery(() => ({
		...historyQuery(api, nodeId),
		enabled: loaded && (tab === 'history' || detail.data?.requested === 'stopped'),
		refetchInterval: tab === 'history' ? 30_000 : false
	}));
	const evaluations = createQuery(() => ({
		...evaluationsQuery(api, nodeId),
		enabled: loaded && tab === 'evaluations'
	}));
	const rollout = createQuery(() => ({
		queryKey: [...deploymentKeys.device(nodeId), 'rollout', detail.data?.revision],
		queryFn: async () =>
			(await unwrap(api.GET('/deployments/{nodeId}/rollout', { params: { path: { nodeId } } })))
				.rollout,
		enabled: loaded && tab === 'evaluations',
		refetchInterval: 30_000
	}));
	const retained = createQuery(() => ({ ...retainedQuery(api), enabled: loaded }));
	const updates = createQuery(() => ({ ...updatesQuery(api), enabled: loaded }));

	const readRows = freshObservations(() => (detail.data ? [detail.data] : []));
	const deployment = $derived(readRows()[0]);
	const notFound = $derived(!validId || (isApiError(detail.error) && detail.error.status === 404));
	const targets = $derived(deployment ? updateTargets(deployment, retained.data ?? []) : []);
	// A newer upstream version worth mentioning only while it still has to be downloaded.
	const published = $derived.by(() => {
		const version = updates.data?.find((update) => update.nodeId === nodeId)?.availableVersion;
		return version && !targets.some((target) => target.version === version) ? version : undefined;
	});

	// Staged but never asked to run: the operator still has to provide secrets and start it.
	const neverStarted = $derived(
		deployment?.requested === 'stopped' &&
			history.data !== undefined &&
			history.data.every((entry) => entry.requested === 'stopped')
	);
	const secrets = $derived(deployment ? secretReferences(deployment.settings) : []);

	let action = $state<LifecycleAction>('start');
	let actionOpen = $state(false);
	let renameOpen = $state(false);
	let deleteOpen = $state(false);
	const notices = getNotices();
	type Notice = { nodeId: string; title: string; body: string };
	let notice = $state<Notice | null>(null);
	const visibleNotice = $derived(notice?.nodeId === nodeId ? notice : null);

	function openAction(next: LifecycleAction) {
		action = next;
		actionOpen = true;
	}

	function refresh() {
		void queryClient.invalidateQueries({ queryKey: deploymentKeys.list() });
		return queryClient.invalidateQueries({ queryKey: deploymentKeys.device(nodeId) });
	}

	function applied({ action, submission, version }: AppliedChange) {
		const revision = submission.revision;
		const titles: Record<LifecycleAction, () => string> = {
			start: () => m.notice_started({ revision }),
			stop: () => m.notice_stopped({ revision }),
			update: () => m.notice_updated({ version, revision }),
			rollback: () => m.notice_rolled_back({ version, revision })
		};
		notice = submission.unchanged
			? { nodeId, title: m.notice_unchanged_title(), body: m.notice_unchanged_body() }
			: { nodeId, title: titles[action](), body: m.notice_accepted_body() };
		void refresh();
	}

	function renamed() {
		void refresh();
	}

	async function deleted({ registrationVariable }: Deletion) {
		const name = deployment ? deviceName(deployment) : nodeId;
		notices.leave('/(app)/deployments', {
			tone: registrationVariable === 'failed' ? 'warn' : 'info',
			title: m.delete_done({ name }),
			body:
				registrationVariable === 'failed'
					? m.delete_done_variable_failed({
							variable: `nomad/jobs/driverhub-${nodeId}/device/driver`
						})
					: m.delete_done_body({ variable: `nomad/jobs/driverhub-${nodeId}` })
		});
		queryClient.removeQueries({ queryKey: deploymentKeys.device(nodeId) });
		void queryClient.invalidateQueries({ queryKey: deploymentKeys.list() });
		void queryClient.invalidateQueries({ queryKey: siteKeys.all });
		await goto(resolve('/(app)/deployments'));
	}

	const admin = $derived(session.isAdmin);
</script>

<a class="back" href={resolve('/(app)/deployments')}>
	<ArrowLeft size={15} aria-hidden="true" />
	{m.nav_deployments()}
</a>

{#if notFound}
	<PageHeader title={m.deployment_not_found_title()} />
	<Card>
		<EmptyState icon={SearchX} title={m.deployment_not_found_title()}>
			<p>{m.deployment_not_found_body({ nodeId })}</p>
			{#snippet actions()}
				<Button href={resolve('/(app)/deployments')}>{m.deployment_back_to_list()}</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else if !deployment}
	<PageHeader title={m.deployment_title()} />
	{#if detail.error}
		<Callout tone="fail" title={m.deployment_error_title()} live>{detail.error.message}</Callout>
		<div>
			<Button onclick={() => detail.refetch()} busy={detail.isFetching}>{m.common_retry()}</Button>
		</div>
	{:else}
		<Card><Loading label={m.deployment_loading()} /></Card>
	{/if}
{:else}
	<PageHeader
		title={deviceName(deployment)}
		description={m.deployment_driver_line({
			driver: deployment.driverId,
			version: deployment.version
		})}
	>
		{#snippet actions()}
			{#if deployment.requested === 'stopped'}
				<Button variant="primary" icon={Play} onclick={() => openAction('start')}>
					{admin ? m.action_start() : m.action_preview_start()}
				</Button>
			{:else}
				<Button icon={Square} onclick={() => openAction('stop')}>
					{admin ? m.action_stop() : m.action_preview_stop()}
				</Button>
			{/if}
			<Button icon={CircleArrowUp} onclick={() => openAction('update')}>
				{admin ? m.action_update() : m.action_preview_update()}
			</Button>
			{#if admin || deployment.previousVersion}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<IconButton {...props} icon={Ellipsis} label={m.deployment_more_actions()} />
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content class="menu-content" align="end" sideOffset={6}>
							{#if admin}
								<DropdownMenu.Item class="menu-item" onSelect={() => (renameOpen = true)}>
									<Pencil size={15} aria-hidden="true" />
									{deployment.label ? m.action_rename() : m.action_name()}
								</DropdownMenu.Item>
							{/if}
							{#if admin}
								<DropdownMenu.Item class="menu-item" onSelect={() => (deleteOpen = true)}>
									<Trash2 size={15} aria-hidden="true" />
									{m.delete_action()}
								</DropdownMenu.Item>
							{/if}
							{#if deployment.previousVersion}
								<DropdownMenu.Item class="menu-item" onSelect={() => openAction('rollback')}>
									<Undo2 size={15} aria-hidden="true" />
									{admin
										? m.action_rollback({ version: deployment.previousVersion })
										: m.action_preview_rollback({ version: deployment.previousVersion })}
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			{/if}
		{/snippet}
	</PageHeader>

	{#if visibleNotice}
		<!-- Neutral, not "verified": Nomad accepting a change says nothing about the driver yet. -->
		<Callout title={visibleNotice.title} live>{visibleNotice.body}</Callout>
	{/if}
	{#if deployment.requiresOriginalStopped}
		<Callout tone="warn" title={m.deployment_migration_title()}>
			{m.deployment_migration_body()}
		</Callout>
	{/if}
	{#if neverStarted}
		<Callout title={m.deployment_staged_title()}>
			{#if secrets.length}
				<p>
					{m.stage_next_secrets({ variable: `nomad/jobs/driverhub-${deployment.nodeId}` })}
					<code>{secrets.join(', ')}</code>
				</p>
			{/if}
			<p>{m.deployment_staged_body()}</p>
		</Callout>
	{/if}
	{#if detail.error}
		<Callout tone="warn" title={m.deployment_stale_title()} live>
			{m.deployments_stale_body({ detail: detail.error.message })}
		</Callout>
	{/if}

	<div class="layout">
		<div class="column">
			<Card
				title={m.deployment_status_title()}
				description={m.deployment_status_description()}
				flush
			>
				<StatusHops
					input={{
						...detailStatusInput(deployment),
						communicationEvidence: deployment.communicationEvidence
					}}
				/>
			</Card>

			<Card flush>
				<Tabs
					bind:value={tab}
					label={m.deployment_diagnostics_label()}
					tabs={[
						{
							value: 'allocations',
							label: m.deployment_tab_allocations(),
							count: deployment.allocations.length,
							panel: allocationsPanel
						},
						{
							value: 'history',
							label: m.deployment_tab_history(),
							count: history.data?.length,
							panel: historyPanel
						},
						{
							value: 'evaluations',
							label: m.deployment_tab_evaluations(),
							count: evaluations.data?.length,
							panel: evaluationsPanel
						}
					]}
				/>
			</Card>
		</div>

		<div class="column">
			<Card title={m.deployment_device_title()}>
				<DeviceFacts {deployment} />
			</Card>
			<Card title={m.deployment_configuration_title()}>
				<ConfigurationList settings={deployment.settings} />
				<p class="footnote settings-note">
					{m.deployment_configuration_note({ nodeId: deployment.nodeId })}
				</p>
			</Card>
		</div>
	</div>

	<LifecycleDialog
		bind:open={actionOpen}
		{action}
		{deployment}
		{targets}
		{published}
		canApply={admin}
		onReload={refresh}
		onApplied={applied}
	/>
	{#if admin}
		<DeleteDeploymentDialog bind:open={deleteOpen} {deployment} onDeleted={deleted} />
		<RenameDialog
			bind:open={renameOpen}
			nodeId={deployment.nodeId}
			label={deployment.label}
			onRenamed={renamed}
		/>
	{/if}

	{#snippet allocationsPanel()}
		{#if deployment.allocations.length}
			<AllocationsTable allocations={deployment.allocations} />
		{:else}
			<p class="panel-note">{m.deployment_no_allocations()}</p>
		{/if}
	{/snippet}

	{#snippet historyPanel()}
		{#if history.data?.length}
			<HistoryTable history={history.data} currentRevision={deployment.revision} />
		{:else if history.error}
			<p class="panel-note">{m.deployment_panel_error({ detail: history.error.message })}</p>
		{:else if history.data}
			<p class="panel-note">{m.deployment_no_history()}</p>
		{:else}
			<Loading label={m.deployment_history_loading()} />
		{/if}
	{/snippet}

	{#snippet evaluationsPanel()}
		{#if rollout.data}<p class="panel-note">
				{m.deployment_rollout({ version: rollout.data.jobVersion, status: rollout.data.status })}
			</p>
		{:else if rollout.error}<p class="panel-note">
				{m.deployment_panel_error({ detail: rollout.error.message })}
			</p>{/if}
		{#if evaluations.data?.length}
			<EvaluationsTable evaluations={evaluations.data} />
		{:else if evaluations.error}
			<p class="panel-note">
				{m.deployment_panel_error({ detail: evaluations.error.message })}
			</p>
		{:else if evaluations.data}
			<p class="panel-note">{m.deployment_no_evaluations()}</p>
		{:else}
			<Loading label={m.deployment_evaluations_loading()} />
		{/if}
		<p class="panel-note footnote">{m.deployment_evaluations_note()}</p>
	{/snippet}
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

	.panel-note {
		padding: var(--space-4);
		color: var(--text-2);
	}

	.footnote {
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	.panel-note.footnote {
		padding-top: 0;
	}

	.settings-note {
		margin-top: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border);
	}
</style>
