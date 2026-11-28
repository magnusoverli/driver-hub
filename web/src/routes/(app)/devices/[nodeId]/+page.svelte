<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleArrowUp from '@lucide/svelte/icons/circle-arrow-up';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Play from '@lucide/svelte/icons/play';
	import SearchX from '@lucide/svelte/icons/search-x';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
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
	import StatusSteps from '#lib/deployments/StatusSteps.svelte';
	import { secretReferences } from '#lib/deployments/configuration-form.js';
	import { detailStatusInput } from '#lib/deployments/status-path.js';
	import { freshObservations } from '#lib/deployments/observations.svelte.js';
	import {
		condition,
		conditionLabel,
		deviceName,
		updateTargets,
		type Condition
	} from '#lib/deployments/view.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { getNotices } from '#lib/shell/notices.js';
	import { siteKeys } from '#lib/site/settings.js';
	import { imageDistributionSummary } from '#lib/system/image-distribution.js';
	import { imageDistributionQuery } from '#lib/system/queries.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import CopyButton from '#lib/ui/CopyButton.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import HelpTip from '#lib/ui/HelpTip.svelte';
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
	// Tasks Hub cannot do or check for the operator, shown until the driver first runs.
	const beforeStart = $derived(
		deployment?.requested === 'stopped' &&
			(neverStarted || deployment.requiresOriginalStopped) &&
			(secrets.length > 0 || deployment.requiresOriginalStopped)
	);
	const images = createQuery(() => ({ ...imageDistributionQuery(api), enabled: loaded }));

	let action = $state<LifecycleAction>('start');
	let configure = $state(false);
	let actionOpen = $state(false);
	let renameOpen = $state(false);
	let deleteOpen = $state(false);
	const notices = getNotices();
	const setupNotice = $derived(notices.take(`/devices/${nodeId}`)[0]);
	type Notice = { nodeId: string; title: string; body: string };
	let notice = $state<Notice | null>(null);
	const visibleNotice = $derived(notice?.nodeId === nodeId ? notice : null);

	function openAction(next: LifecycleAction, options: { configure?: boolean } = {}) {
		action = next;
		configure = options.configure ?? false;
		actionOpen = true;
	}

	/** The newest downloaded version the device can move to, offered as the main update action. */
	const newer = $derived(targets.find((target) => target.newer));
	const current = $derived<Condition>(
		deployment ? condition(detailStatusInput(deployment)) : 'unavailable'
	);
	// A site problem shows here only when it can be why this driver does not run.
	const imageProblem = $derived(
		(current === 'starting' || current === 'allocation-failed') &&
			images.data !== undefined &&
			images.data.state !== 'ready'
	);
	/** What the operator can do next, by condition. */
	const nextStep: Record<Condition, () => string> = {
		unavailable: m.device_next_unavailable,
		stopped: m.device_next_stopped,
		'allocation-failed': m.device_next_allocation_failed,
		starting: m.device_next_starting,
		'check-failed': m.device_next_check_failed,
		connected: m.device_next_connected,
		running: m.device_next_running
	};

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
			: {
					nodeId,
					title: configure ? m.notice_configured({ revision }) : titles[action](),
					body: m.notice_accepted_body()
				};
		void refresh();
	}

	function renamed() {
		void refresh();
	}

	async function deleted({ registrationVariable }: Deletion) {
		const name = deployment ? deviceName(deployment) : nodeId;
		notices.leave('/(app)', {
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
		await goto(resolve('/(app)'));
	}

	const admin = $derived(session.isAdmin);
</script>

<a class="back" href={resolve('/(app)')}>
	<ArrowLeft size={15} aria-hidden="true" />
	{m.nav_devices()}
</a>

{#if notFound}
	<PageHeader title={m.deployment_not_found_title()} />
	<Card>
		<EmptyState icon={SearchX} title={m.deployment_not_found_title()}>
			<p>{m.deployment_not_found_body({ nodeId })}</p>
			{#snippet actions()}
				<Button href={resolve('/(app)')}>{m.deployment_back_to_list()}</Button>
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
		{#snippet titleAction()}
			{#if admin}
				<IconButton
					size="sm"
					icon={Pencil}
					label={deployment.label ? m.action_rename() : m.action_name()}
					onclick={() => (renameOpen = true)}
				/>
			{/if}
		{/snippet}
		{#snippet actions()}
			{#if newer}
				<Button icon={CircleArrowUp} onclick={() => openAction('update')}>
					{admin
						? m.device_update_to({ version: newer.version })
						: m.device_preview_update_to({ version: newer.version })}
				</Button>
			{/if}
			{#if deployment.requested === 'stopped'}
				<Button variant="primary" icon={Play} onclick={() => openAction('start')}>
					{admin ? m.action_start() : m.action_preview_start()}
				</Button>
			{:else}
				<Button icon={Square} onclick={() => openAction('stop')}>
					{admin ? m.action_stop() : m.action_preview_stop()}
				</Button>
			{/if}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<IconButton {...props} icon={Ellipsis} label={m.deployment_more_actions()} />
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content class="menu-content" align="end" sideOffset={6}>
						{#if admin}
							<DropdownMenu.Item
								class="menu-item"
								onSelect={() => openAction('update', { configure: true })}
							>
								<SlidersHorizontal size={15} aria-hidden="true" />
								{m.configure_action()}
							</DropdownMenu.Item>
						{/if}
						<DropdownMenu.Item class="menu-item" onSelect={() => openAction('update')}>
							<CircleArrowUp size={15} aria-hidden="true" />
							{admin ? m.device_change_version() : m.device_preview_change_version()}
						</DropdownMenu.Item>
						{#if deployment.previousVersion}
							<DropdownMenu.Item class="menu-item" onSelect={() => openAction('rollback')}>
								<Undo2 size={15} aria-hidden="true" />
								{admin
									? m.action_rollback({ version: deployment.previousVersion })
									: m.action_preview_rollback({ version: deployment.previousVersion })}
							</DropdownMenu.Item>
						{/if}
						{#if admin}
							<DropdownMenu.Item class="menu-item" onSelect={() => (deleteOpen = true)}>
								<Trash2 size={15} aria-hidden="true" />
								{m.delete_action()}
							</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		{/snippet}
	</PageHeader>

	{#if setupNotice}
		<Callout tone={setupNotice.tone} title={setupNotice.title} live>{setupNotice.body}</Callout>
	{/if}
	{#if visibleNotice}
		<!-- Neutral, not "verified": Nomad accepting a change says nothing about the driver yet. -->
		<Callout title={visibleNotice.title} live>{visibleNotice.body}</Callout>
	{/if}
	{#if detail.error}
		<Callout tone="warn" title={m.deployment_stale_title()} live>
			{m.deployments_stale_body({ detail: detail.error.message })}
		</Callout>
	{/if}

	<div class="layout">
		<div class="column">
			<Card title={m.device_status_title()}>
				<div class="status" data-condition={neverStarted ? 'staged' : current}>
					<p class="headline">
						{neverStarted ? m.deployment_staged_title() : conditionLabel(current)}
					</p>
					<StatusSteps
						input={{
							...detailStatusInput(deployment),
							communicationEvidence: deployment.communicationEvidence
						}}
					/>
					<p>
						{beforeStart
							? m.device_next_before_start()
							: neverStarted
								? m.deployment_staged_body()
								: current === 'running' &&
									  deployment.communicationEvidence.reason === 'no_control_check'
									? m.device_next_no_control_check()
									: nextStep[current]()}
					</p>
					{#if imageProblem && images.data}
						<Callout tone="warn" title={m.device_image_problem_title()}>
							<p>{imageDistributionSummary(images.data)}</p>
							{#if admin}
								<a href={resolve('/(app)/settings/nomad')}>{m.device_image_problem_link()}</a>
							{/if}
						</Callout>
					{/if}
				</div>
			</Card>

			{#if beforeStart}
				<Card title={m.device_before_start_title()}>
					<ol class="tasks">
						{#if secrets.length}
							<li>
								{m.stage_next_secrets({ variable: `nomad/jobs/driverhub-${deployment.nodeId}` })}
								<code>{secrets.join(', ')}</code>
							</li>
						{/if}
						{#if deployment.requiresOriginalStopped}
							<li>
								<strong>{m.deployment_migration_title()}.</strong>
								{m.deployment_migration_body()}
							</li>
						{/if}
						<li>{m.device_before_start_run()}</li>
					</ol>
				</Card>
			{/if}

			<Card title={m.deployment_configuration_title()}>
				{#snippet actions()}
					{#if admin}
						<Button size="sm" onclick={() => openAction('update', { configure: true })}>
							{m.configure_edit()}
						</Button>
					{/if}
				{/snippet}
				<ConfigurationList settings={deployment.settings} />
				{#if secrets.length}
					<p class="footnote settings-note">
						{m.deployment_configuration_note({ nodeId: deployment.nodeId })}
					</p>
				{/if}
			</Card>
		</div>

		<div class="column">
			<Card title={m.deployment_device_title()}>
				<!-- The node ID gets the full width: it is what an operator looks for in VideoIPath. -->
				<div class="node-id">
					<span class="with-help">
						{m.device_videoipath_node_id()}
						<HelpTip label={m.device_videoipath_node_id()} help={m.device_videoipath_help()} />
					</span>
					<span class="with-copy">
						<code>{deployment.nodeId}</code>
						<CopyButton value={deployment.nodeId} label={m.facts_copy_node_id()} />
					</span>
				</div>
				<Facts>
					<dt>{m.facts_driver()}</dt>
					<dd>
						<a href={resolve('/(app)/catalog/[driverId]', { driverId: deployment.driverId })}>
							{deployment.driverId}
						</a>
					</dd>
					<dt>{m.facts_version()}</dt>
					<dd>
						<span class="mono">{deployment.version}</span>
						{#if deployment.previousVersion}
							<span class="secondary">
								{m.facts_previous_version({ version: deployment.previousVersion })}
							</span>
						{/if}
					</dd>
				</Facts>
			</Card>
		</div>
	</div>

	<details class="diagnostics">
		<summary>{m.deployment_diagnostics_summary()}</summary>
		<div class="diagnostics-body">
			<div class="layout">
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
				<Card title={m.device_technical_title()}>
					<DeviceFacts {deployment} />
				</Card>
			</div>

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
	</details>
	<LifecycleDialog
		bind:open={actionOpen}
		{action}
		{configure}
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
	.status {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.status p {
		color: var(--text-2);
	}

	.status .headline {
		color: var(--text);
		font-size: var(--text-xl);
		font-weight: var(--weight-bold);
	}

	[data-condition='connected'] .headline {
		color: var(--ok);
	}

	[data-condition='check-failed'] .headline,
	[data-condition='allocation-failed'] .headline {
		color: var(--fail);
	}

	[data-condition='unavailable'] .headline {
		color: var(--warn);
	}

	.tasks {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 0;
		padding-left: var(--space-5);
		color: var(--text-2);
	}

	.tasks code {
		overflow-wrap: anywhere;
	}

	.node-id {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
		padding-bottom: var(--space-4);
		border-bottom: 1px solid var(--border);
	}

	.node-id .with-help {
		color: var(--text-3);
	}

	.with-help {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	/* The node ID wraps beside its copy button instead of pushing it to its own line. */
	.with-copy {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-width: 0;
	}

	.with-copy code {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.with-copy :global(.icon-button) {
		flex: none;
		margin-top: -0.3rem;
	}

	.secondary {
		display: block;
		color: var(--text-3);
		font-size: var(--text-sm);
	}

	.diagnostics > summary {
		cursor: pointer;
		padding: var(--space-3) 0;
		font-weight: var(--weight-semibold);
	}

	.diagnostics-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

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
