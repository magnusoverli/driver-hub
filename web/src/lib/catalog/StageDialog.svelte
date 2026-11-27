<script lang="ts">
	import { untrack } from 'svelte';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { deploymentKeys } from '#lib/deployments/queries.js';
	import ConfigurationFields from '#lib/deployments/ConfigurationFields.svelte';
	import {
		fieldProblems,
		initialValues,
		secretReferences,
		settingsFromValues,
		type SettingValues
	} from '#lib/deployments/configuration-form.js';
	import {
		deployForm,
		nodeIdProblem,
		stageDeployment,
		stageProblem,
		type StageBody,
		type StageProblem
	} from '#lib/deployments/stage.js';
	import { imageDigest, labelProblem, shortDigest } from '#lib/deployments/view.js';
	import type { Preview } from '#lib/deployments/lifecycle.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { capabilitiesQuery, systemKeys } from '#lib/system/queries.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import RadioGroup from '#lib/ui/RadioGroup.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import type { Identity } from './queries';

	type Props = { open: boolean; release: Identity & { displayName?: string } };

	let { open = $bindable(), release }: Props = $props();

	const api = getApi();
	const session = getSession();
	const client = useQueryClient();
	const formId = $props.id();
	const capabilities = createQuery(() => capabilitiesQuery(api));
	const siteAvailable = $derived(capabilities.data?.videoIPathConfigured === true);

	let identity = $state<'new' | 'replace'>('new');
	let existingId = $state('');
	let connection = $state<'site' | 'manual'>('site');
	let label = $state('');
	let values = $state<SettingValues>({});
	let attempted = $state(false);
	let busy = $state(false);
	let problem = $state<StageProblem | null>(null);
	let review = $state<{ body: StageBody; nodeId: string; plan: Preview } | null>(null);
	/** A new device's node ID; also the request key, so retrying cannot create a second device. */
	let key = $state(crypto.randomUUID());
	/** The request last sent for real. Changing anything after an unclear outcome needs a new key. */
	let attemptedBody = '';
	/** Node ID of a deployment an unanswered stage request may have created. */
	let possiblyStaged = $state<string | null>(null);

	const inheritSite = $derived(siteAvailable && connection === 'site');
	const path = $derived({ driverId: release.driverId, version: release.version });
	const form = createQuery(() => ({
		queryKey: ['deployments', 'stage-form', path, inheritSite],
		queryFn: () => deployForm(api, path, { inheritSite }),
		enabled: capabilities.data !== undefined
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
	const problems = $derived(form.data ? fieldProblems(form.data, values, reported) : new Map());
	const nameError = $derived(attempted && label.trim() ? labelProblem(label) : null);
	const idError = $derived(attempted && identity === 'replace' ? nodeIdProblem(existingId) : null);
	const variable = $derived(`nomad/jobs/driverhub-${nodeId || '…'}`);

	function body(): StageBody {
		const settings = form.data ? settingsFromValues(form.data, values) : {};
		return {
			...path,
			settings,
			inheritSite,
			...(label.trim() && { label: label.trim() }),
			...(identity === 'replace' && { nodeId: existingId.trim() })
		};
	}

	async function preview(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		problem = null;
		if (!form.data || busy) return;
		if (
			(label.trim() && labelProblem(label)) ||
			(identity === 'replace' && nodeIdProblem(existingId))
		) {
			return;
		}
		if (fieldProblems(form.data, values).size) return;
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
			if ('preview' in plan) review = { body: request, nodeId, plan };
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
			key = crypto.randomUUID();
			review = null;
			problem = { kind: 'other', message: m.stage_problem_preview_again() };
			return;
		}
		attemptedBody = serialized;
		busy = true;
		problem = null;
		try {
			const submission = await stageDeployment(api, review.body, key, false);
			if (!('nodeId' in submission)) return;
			open = false;
			void client.invalidateQueries({ queryKey: deploymentKeys.all });
			void client.invalidateQueries({ queryKey: systemKeys.all });
			await goto(resolve('/(app)/deployments/[nodeId]', { nodeId: submission.nodeId }));
		} catch (error) {
			problem = stageProblem(error, true);
			if (problem.kind === 'uncertain') possiblyStaged = review.nodeId;
			if (problem.kind === 'settings') review = null;
		} finally {
			busy = false;
		}
	}

	function edit() {
		review = null;
		problem = null;
		// After a definite refusal, a changed request is a new request.
		if (attemptedBody) {
			key = crypto.randomUUID();
			attemptedBody = '';
		}
	}

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
</script>

<Dialog
	bind:open
	title={m.stage_title({ name: release.displayName ?? release.driverId })}
	description={m.stage_description({ driver: release.driverId, version: release.version })}
	width="lg"
	dismissible={!busy}
>
	{#if review}
		<div class="stack">
			<Facts>
				<dt>{m.stage_review_release()}</dt>
				<dd class="mono">{release.driverId} {release.version}</dd>
				<dt>{m.stage_review_name()}</dt>
				<dd>{review.body.label ?? m.deployment_unnamed()}</dd>
				<dt>{m.facts_node_id()}</dt>
				<dd><code>{review.nodeId}</code></dd>
				<dt>{m.stage_review_connection()}</dt>
				<dd>
					{review.body.inheritSite ? m.stage_connection_site() : m.stage_connection_manual_review()}
				</dd>
				<dt>{m.preview_image()}</dt>
				<dd><code>{shortDigest(imageDigest(review.plan.image))}</code></dd>
				<dt>{m.preview_requested()}</dt>
				<dd>{m.requested_stopped()}</dd>
			</Facts>
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
			{#if problem}
				<Callout tone={problem.kind === 'uncertain' ? 'warn' : 'fail'} title={problem.message} live>
					{#if problem.kind === 'pool'}
						<a href={resolve('/(app)/settings/videoipath')}>{m.stage_problem_pool_link()}</a>
					{/if}
				</Callout>
			{/if}
			{#if !session.isAdmin}<p class="note">{m.preview_viewer_note()}</p>{/if}
		</div>
	{:else if form.error}
		<Callout tone="fail" title={m.stage_form_error()} live>{form.error.message}</Callout>
	{:else if !form.data}
		<Loading label={m.stage_form_loading()} />
	{:else}
		<form id={formId} class="stack" onsubmit={preview} novalidate>
			{#if possiblyStaged}
				<Callout tone="warn" title={m.stage_possibly_staged_title()}>
					{m.stage_possibly_staged_body({ nodeId: possiblyStaged })}
					<a href={resolve('/(app)/deployments/[nodeId]', { nodeId: possiblyStaged })}>
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
			{#if siteAvailable}
				<RadioGroup
					legend={m.stage_connection()}
					options={connectionOptions}
					bind:value={connection}
				/>
			{:else}
				<p class="note">{m.stage_connection_unavailable()}</p>
			{/if}
			<fieldset class="settings">
				<legend>{m.stage_configuration()}</legend>
				<ConfigurationFields
					form={form.data}
					bind:values
					{problems}
					showProblems={attempted}
					{variable}
				/>
			</fieldset>
		</form>
	{/if}

	{#snippet footer()}
		{#if review}
			<Button variant="ghost" class="back" disabled={busy} onclick={edit}>{m.common_back()}</Button>
			<Button variant="ghost" disabled={busy} onclick={() => (open = false)}>
				{session.isAdmin ? m.common_cancel() : m.common_close()}
			</Button>
			{#if session.isAdmin}
				<Button variant="primary" {busy} onclick={stage}>
					{problem?.kind === 'uncertain' ? m.stage_retry() : m.stage_apply()}
				</Button>
			{/if}
		{:else}
			<Button variant="ghost" disabled={busy} onclick={() => (open = false)}>
				{m.common_cancel()}
			</Button>
			<Button variant="primary" type="submit" form={formId} {busy} disabled={!form.data}>
				{m.stage_preview()}
			</Button>
		{/if}
	{/snippet}
</Dialog>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
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

	.note {
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	:global(.dialog-footer .back) {
		margin-right: auto;
	}
</style>
