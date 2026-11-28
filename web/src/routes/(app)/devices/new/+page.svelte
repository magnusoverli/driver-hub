<script lang="ts">
	import { untrack } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { operationKey } from '#lib/api/operation-key.js';
	import { catalogDrivers } from '#lib/catalog/drivers.js';
	import { retainedQuery } from '#lib/catalog/queries.js';
	import ConfigurationFields from '#lib/deployments/ConfigurationFields.svelte';
	import {
		fieldErrorText,
		fieldProblems,
		initialValues,
		secretReferences,
		settingsFromValues,
		type SettingValues
	} from '#lib/deployments/configuration-form.js';
	import {
		actionProblem,
		applyAction,
		previewAction,
		type Preview
	} from '#lib/deployments/lifecycle.js';
	import { deploymentKeys } from '#lib/deployments/queries.js';
	import {
		deployForm,
		nodeIdProblem,
		stageDeployment,
		stageProblem,
		type StageBody,
		type StageProblem
	} from '#lib/deployments/stage.js';
	import { imageDigest, labelProblem } from '#lib/deployments/view.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { getNotices } from '#lib/shell/notices.js';
	import { capabilitiesQuery, systemKeys } from '#lib/system/queries.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import RadioGroup from '#lib/ui/RadioGroup.svelte';
	import SelectField from '#lib/ui/SelectField.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	const STEPS = ['driver', 'device', 'settings', 'review'] as const;
	type Step = (typeof STEPS)[number];

	const api = getApi();
	const session = getSession();
	const notices = getNotices();
	const client = useQueryClient();
	const formId = $props.id();
	const capabilities = createQuery(() => capabilitiesQuery(api));
	const cluster = $derived(capabilities.data?.nomadConfigured === true);
	const siteAvailable = $derived(capabilities.data?.videoIPathConfigured === true);
	const retained = createQuery(() => retainedQuery(api));
	const drivers = $derived(
		catalogDrivers({ published: [], retained: retained.data ?? [] }).filter(
			(driver) => driver.newestDownloaded !== undefined
		)
	);

	// The catalog links here with the release already chosen.
	const requested = new URL(location.href).searchParams;
	let driverId = $state(requested.get('driver') ?? '');
	let version = $state(requested.get('version') ?? '');
	let step = $state<Step>(requested.get('driver') ? 'device' : 'driver');

	const driver = $derived(drivers.find((entry) => entry.driverId === driverId));
	const downloadedVersions = $derived(
		(driver?.versions ?? []).filter((entry) => entry.retained !== undefined)
	);
	const release = $derived(downloadedVersions.find((entry) => entry.version === version)?.retained);
	// Default to the newest downloaded version of whichever driver is chosen.
	$effect(() => {
		if (driver && !downloadedVersions.some((entry) => entry.version === version)) {
			untrack(() => (version = driver.newestDownloaded?.version ?? ''));
		}
	});
	$effect(() => {
		if (retained.data && !drivers.some((entry) => entry.driverId === driverId)) {
			untrack(() => {
				driverId = drivers[0]?.driverId ?? '';
				step = 'driver';
			});
		}
	});

	let optionsOpen = $state(false);
	let startNow = $state(true);
	let identity = $state<'new' | 'replace'>('new');
	let existingId = $state('');
	let connection = $state<'site' | 'manual'>('site');
	let label = $state('');
	let values = $state<SettingValues>({});
	let attemptedDevice = $state(false);
	let attempted = $state(false);
	let busy = $state(false);
	let problem = $state<StageProblem | null>(null);
	let review = $state<{ body: StageBody; nodeId: string; plan: Preview } | null>(null);
	/** A new device's node ID; also the request key, so retrying cannot create a second device. */
	let key = $state(operationKey());
	/** The request last sent for real. Changing anything after an unclear outcome needs a new key. */
	let attemptedBody = '';
	/** Node ID of a device an unanswered request may have created. */
	let possiblyStaged = $state<string | null>(null);

	const inheritSite = $derived(siteAvailable && connection === 'site');
	const path = $derived({ driverId, version });
	const form = createQuery(() => ({
		queryKey: ['deployments', 'stage-form', path, inheritSite],
		queryFn: () => deployForm(api, path, { inheritSite }),
		enabled: capabilities.data !== undefined && release !== undefined
	}));

	// Keep what the operator typed when the form changes shape, for example to manual settings.
	$effect(() => {
		const data = form.data;
		if (data) untrack(() => (values = { ...initialValues(data), ...pick(values, data) }));
	});

	function pick(current: SettingValues, data: NonNullable<typeof form.data>): SettingValues {
		const names = new Set(data.fields.map((field) => field.name));
		return Object.fromEntries(Object.entries(current).filter(([name]) => names.has(name)));
	}

	const nodeId = $derived(identity === 'replace' ? existingId.trim() : key);
	const reported = $derived(problem?.kind === 'settings' ? problem.fields : []);
	// Site-supplied inputs this release cannot accept: the site has to change, not the form.
	const siteIssues = $derived(
		form.data?.validation.errors.filter((issue) =>
			form.data?.fields.some((f) => f.source === 'site' && f.name === issue.field)
		) ?? []
	);
	const problems = $derived(form.data ? fieldProblems(form.data, values, reported) : new Map());
	/** The API allows unnamed devices, but every device set up here gets a name. */
	const nameProblem = (value: string) =>
		value.trim() ? labelProblem(value) : m.stage_error_name_required();
	const nameError = $derived(attemptedDevice ? nameProblem(label) : null);
	const idError = $derived(
		attemptedDevice && identity === 'replace' ? nodeIdProblem(existingId) : null
	);
	const variable = $derived(`nomad/jobs/driverhub-${nodeId || '…'}`);
	const releaseName = $derived(release?.displayName ?? driverId);

	function body(): StageBody {
		const settings = form.data ? settingsFromValues(form.data, values) : {};
		return {
			...path,
			settings,
			inheritSite,
			label: label.trim(),
			...(identity === 'replace' && { nodeId: existingId.trim() })
		};
	}

	function chooseDriver(event: SubmitEvent) {
		event.preventDefault();
		if (release) step = 'device';
	}

	function describeDevice(event: SubmitEvent) {
		event.preventDefault();
		attemptedDevice = true;
		if (nameProblem(label) || (identity === 'replace' && nodeIdProblem(existingId))) return;
		step = 'settings';
	}

	async function preview(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		problem = null;
		if (!form.data || busy) return;
		const issues = fieldProblems(form.data, values);
		if (issues.size) {
			if (
				form.data.fields.some((f) => issues.has(f.name) && (!f.required || f.default !== undefined))
			)
				optionsOpen = true;
			return;
		}
		busy = true;
		try {
			const request = body();
			// The form check knows about identity inputs; the dry run plans the job itself.
			const checked = await deployForm(api, path, {
				inheritSite,
				nodeId,
				settings: request.settings
			});
			if (!checked.validation.valid) {
				problem = {
					kind: 'settings',
					message: m.stage_problem_configuration(),
					fields: checked.validation.errors
				};
				return;
			}
			const plan = await stageDeployment(api, request, key, true);
			if ('preview' in plan) {
				review = { body: request, nodeId, plan };
				step = 'review';
			}
		} catch (error) {
			problem = stageProblem(error, false);
		} finally {
			busy = false;
		}
	}

	async function stage() {
		if (!review || busy || !session.isAdmin) return;
		const serialized = JSON.stringify(review.body);
		if (attemptedBody && attemptedBody !== serialized && review.body.nodeId === undefined) {
			// A different request may not reuse the key of one whose outcome is unknown.
			key = operationKey();
			review = null;
			step = 'settings';
			problem = { kind: 'other', message: m.stage_problem_preview_again() };
			return;
		}
		attemptedBody = serialized;
		busy = true;
		problem = null;
		try {
			const submission = await stageDeployment(api, review.body, key, false);
			if (!('nodeId' in submission)) return;
			if (deployNow) {
				const target = { nodeId: submission.nodeId, revision: submission.revision };
				let applying = false;
				try {
					const plan = await previewAction(api, 'start', target);
					if (!plan.schedulable) throw new Error('placement');
					applying = true;
					await applyAction(api, 'start', target);
				} catch (error) {
					notices.leave(`/devices/${submission.nodeId}`, {
						tone: 'warn',
						title: m.stage_start_attention(),
						body:
							error instanceof Error && error.message === 'placement'
								? m.stage_no_placement()
								: actionProblem(error, applying ? 'apply' : 'preview').message
					});
				}
			}
			void client.invalidateQueries({ queryKey: deploymentKeys.all });
			void client.invalidateQueries({ queryKey: systemKeys.all });
			await goto(resolve('/(app)/devices/[nodeId]', { nodeId: submission.nodeId }));
		} catch (error) {
			problem = stageProblem(error, true);
			if (problem.kind === 'uncertain') possiblyStaged = review.nodeId;
			if (problem.kind === 'settings') {
				review = null;
				step = 'settings';
			}
		} finally {
			busy = false;
		}
	}

	/** Back one step; leaving the review drops its plan, and a refused request gets a new key. */
	function back() {
		problem = null;
		if (step === 'review') {
			review = null;
			if (attemptedBody) {
				key = operationKey();
				attemptedBody = '';
			}
		}
		step = STEPS[Math.max(0, STEPS.indexOf(step) - 1)];
	}

	const stepLabels: Record<Step, () => string> = {
		driver: m.setup_step_driver,
		device: m.setup_step_device,
		settings: m.setup_step_settings,
		review: m.setup_step_review
	};
	const driverOptions = $derived(
		drivers.map((entry) => ({
			value: entry.driverId,
			label: entry.name,
			description: entry.driverId
		}))
	);
	const versionOptions = $derived(
		downloadedVersions.map((entry) => ({ value: entry.version, label: entry.version }))
	);
	const identityOptions = $derived([
		{
			value: 'new' as const,
			label: m.stage_identity_new(),
			description: m.stage_identity_new_description()
		},
		{
			value: 'replace' as const,
			label: m.stage_identity_replace(),
			description: m.stage_identity_replace_description()
		}
	]);
	const connectionOptions = $derived([
		{
			value: 'site' as const,
			label: m.stage_connection_site(),
			description: m.stage_connection_site_description()
		},
		{
			value: 'manual' as const,
			label: m.stage_connection_manual(),
			description: m.stage_connection_manual_description()
		}
	]);
	const secrets = $derived(review ? secretReferences(review.body.settings ?? {}) : []);
	const deployNow = $derived(startNow && !review?.body.nodeId && !secrets.length);
	const cancel = resolve('/(app)');
</script>

<a class="back-link" href={cancel}>
	<ArrowLeft size={15} aria-hidden="true" />
	{m.nav_devices()}
</a>

<PageHeader
	title={m.add_device_title()}
	description={release
		? m.setup_page_description({ driver: releaseName, version })
		: m.add_device_description()}
/>

<ol class="stepper" aria-label={m.setup_steps_label()}>
	{#each STEPS as item, index (item)}
		{@const position = STEPS.indexOf(step)}
		<li
			data-state={index < position ? 'done' : index === position ? 'current' : 'next'}
			aria-current={index === position ? 'step' : undefined}
		>
			<span class="number" aria-hidden="true">{index + 1}</span>
			<span>{stepLabels[item]()}</span>
		</li>
	{/each}
</ol>

{#if capabilities.error || retained.error}
	<Callout tone="fail" title={errorMessage(capabilities.error ?? retained.error)} live />
{:else if !capabilities.data || !retained.data}
	<Card><Loading label={m.stage_form_loading()} /></Card>
{:else if !cluster}
	<Callout tone="warn" title={m.setup_no_cluster_title()}>
		<p>{m.setup_no_cluster_body()}</p>
		{#if session.isAdmin}<a href={resolve('/(app)/settings')}>{m.devices_open_site_setup()}</a>{/if}
	</Callout>
{:else if !drivers.length}
	<Card>
		<div class="panel">
			<Callout title={m.add_device_none_title()}>{m.add_device_none_body()}</Callout>
			<div>
				<Button variant="primary" href={resolve('/(app)/catalog')}>
					{m.add_device_open_catalog()}
				</Button>
			</div>
		</div>
	</Card>
{:else}
	<Card>
		{#if step === 'driver'}
			<form id={formId} class="stack" onsubmit={chooseDriver} novalidate>
				<RadioGroup legend={m.add_device_legend()} options={driverOptions} bind:value={driverId} />
				{#if versionOptions.length > 1}
					<SelectField label={m.setup_version()} options={versionOptions} bind:value={version} />
				{/if}
				<p class="note">
					{m.add_device_other()}
					<a href={resolve('/(app)/catalog')}>{m.add_device_catalog_link()}</a>
				</p>
			</form>
		{:else if step === 'device'}
			<form id={formId} class="stack" onsubmit={describeDevice} novalidate>
				<TextField
					label={m.stage_name()}
					bind:value={label}
					autocomplete="off"
					hint={m.stage_name_hint()}
					error={nameError}
				/>
				<RadioGroup legend={m.stage_identity()} options={identityOptions} bind:value={identity} />
				{#if identity === 'replace'}
					<TextField
						label={m.stage_node_id()}
						bind:value={existingId}
						autocomplete="off"
						spellcheck={false}
						placeholder="00000000-0000-4000-8000-000000000000"
						hint={m.stage_node_id_hint()}
						error={idError}
					/>
				{/if}
			</form>
		{:else if step === 'settings'}
			{#if form.error}
				<Callout tone="fail" title={m.stage_form_error()} live>{form.error.message}</Callout>
			{:else if !form.data}
				<Loading label={m.stage_form_loading()} />
			{:else}
				<form id={formId} class="stack" onsubmit={preview} novalidate>
					{#if siteIssues.length}
						<Callout tone="fail" title={m.compat_site()} live>
							{#each siteIssues as issue (issue.field)}
								<p>{issue.field}: {fieldErrorText(issue.code)}</p>
							{/each}
							<a href={resolve('/(app)/settings/videoipath')}>{m.stage_problem_pool_link()}</a>
						</Callout>
					{/if}
					{#if possiblyStaged}
						<Callout tone="warn" title={m.stage_possibly_staged_title()}>
							{m.stage_possibly_staged_body({ nodeId: possiblyStaged })}
							<a href={resolve('/(app)/devices/[nodeId]', { nodeId: possiblyStaged })}>
								{m.stage_possibly_staged_link()}
							</a>
						</Callout>
					{/if}
					{#if problem}
						<Callout tone="fail" title={problem.message} live>
							{#if problem.kind === 'pool'}
								<a href={resolve('/(app)/settings/videoipath')}>{m.stage_problem_pool_link()}</a>
							{/if}
						</Callout>
					{/if}
					<!-- Before the driver's own inputs: entering the connection manually adds some. -->
					{#if siteAvailable}
						<RadioGroup
							legend={m.stage_connection()}
							options={connectionOptions}
							bind:value={connection}
						/>
					{/if}
					<fieldset class="settings">
						<legend>{m.setup_driver_settings()}</legend>
						<ConfigurationFields
							form={form.data}
							bind:values
							{problems}
							showProblems={attempted}
							{variable}
							group="required"
						/>
					</fieldset>
					<details bind:open={optionsOpen}>
						<summary>{m.stage_options()}</summary>
						<div class="stack">
							<ConfigurationFields
								form={form.data}
								bind:values
								{problems}
								showProblems={attempted}
								{variable}
								group="optional"
							/>
						</div>
					</details>
					{#if identity === 'new'}
						<Checkbox bind:checked={startNow} hint={m.stage_start_now_hint()}>
							{m.stage_start_now()}
						</Checkbox>
					{/if}
				</form>
			{/if}
		{:else if review}
			<div class="stack">
				<Facts>
					<dt>{m.stage_review_name()}</dt>
					<dd>{review.body.label}</dd>
					<dt>{m.stage_review_release()}</dt>
					<dd>{releaseName} · {version}</dd>
					{#if review.body.nodeId}
						<dt>{m.stage_node_id()}</dt>
						<dd><code>{review.nodeId}</code></dd>
					{/if}
					<dt>{m.stage_review_connection()}</dt>
					<dd>
						{review.body.inheritSite ? m.stage_review_site() : m.stage_connection_manual_review()}
					</dd>
				</Facts>
				{#if deployNow}
					<Callout title={m.stage_result_title()}>{m.stage_result_body()}</Callout>
				{:else}
					<Callout title={m.stage_next_title()}>
						<ol class="steps">
							{#if secrets.length}
								<li>
									{m.stage_next_secrets({ variable: `nomad/jobs/driverhub-${review.nodeId}` })}
									<code>{secrets.join(', ')}</code>
								</li>
							{/if}
							{#if review.body.nodeId}<li>{m.stage_next_original()}</li>{/if}
							<li>{m.stage_next_start()}</li>
							{#if !review.body.nodeId}<li>{m.stage_next_approve()}</li>{/if}
						</ol>
					</Callout>
				{/if}
				<details>
					<summary>{m.stage_technical_details()}</summary>
					<Facts>
						{#if !review.body.nodeId}
							<dt>{m.facts_node_id()}</dt>
							<dd><code>{review.nodeId}</code></dd>
						{/if}
						<dt>{m.preview_image()}</dt>
						<dd><code>{imageDigest(review.plan.image)}</code></dd>
					</Facts>
				</details>
				{#if problem}
					<Callout
						tone={problem.kind === 'uncertain' ? 'warn' : 'fail'}
						title={problem.message}
						live
					>
						{#if problem.kind === 'pool'}
							<a href={resolve('/(app)/settings/videoipath')}>{m.stage_problem_pool_link()}</a>
						{/if}
					</Callout>
				{/if}
				{#if !session.isAdmin}<p class="note">{m.preview_viewer_note()}</p>{/if}
			</div>
		{/if}

		<div class="footer">
			{#if step !== 'driver'}
				<Button variant="ghost" class="back" disabled={busy} onclick={back}>
					{m.common_back()}
				</Button>
			{/if}
			<Button variant="ghost" href={cancel}>{m.common_cancel()}</Button>
			{#if step === 'review'}
				{#if session.isAdmin}
					<Button variant="primary" {busy} onclick={stage}>
						{problem?.kind === 'uncertain'
							? m.stage_retry()
							: deployNow
								? m.stage_deploy()
								: m.stage_apply()}
					</Button>
				{/if}
			{:else if step === 'settings'}
				<Button
					variant="primary"
					type="submit"
					form={formId}
					{busy}
					disabled={!form.data || siteIssues.length > 0}
				>
					{m.stage_preview()}
				</Button>
			{:else}
				<Button
					variant="primary"
					type="submit"
					form={formId}
					disabled={step === 'driver' && !release}
				>
					{m.common_continue()}
				</Button>
			{/if}
		</div>
	</Card>
{/if}

<style>
	.back-link {
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

	.back-link:hover {
		color: var(--text);
	}

	.stepper {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--text-3);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}

	.stepper li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.number {
		display: inline-grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-pill);
		background: var(--sunken);
		font-variant-numeric: tabular-nums;
	}

	[data-state='current'] {
		color: var(--text);
		font-weight: var(--weight-semibold);
	}

	[data-state='current'] .number {
		background: var(--accent);
		color: var(--accent-ink);
	}

	[data-state='done'] .number {
		background: var(--accent-soft);
		color: var(--accent-text);
	}

	.stack,
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 44rem;
	}

	.settings {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.settings legend {
		padding: 0;
		margin-bottom: var(--space-3);
		font-weight: var(--weight-semibold);
	}

	.steps {
		margin: var(--space-1) 0 0;
		padding-left: var(--space-5);
	}

	.steps li + li {
		margin-top: var(--space-1);
	}

	summary {
		cursor: pointer;
	}

	details[open] summary {
		margin-bottom: var(--space-3);
	}

	dd code {
		overflow-wrap: anywhere;
	}

	.note {
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	.footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-5);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border);
	}

	.footer :global(.back) {
		margin-right: auto;
	}
</style>
