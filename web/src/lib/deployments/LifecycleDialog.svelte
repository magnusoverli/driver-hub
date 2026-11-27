<script lang="ts">
	import { untrack } from 'svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { createQuery } from '@tanstack/svelte-query';
	import { getApi } from '#lib/api/context.js';
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import {
		actionProblem,
		applyAction,
		previewAction,
		settingsErrorText,
		type ActionInput,
		type ActionProblem,
		type AppliedChange,
		type LifecycleAction,
		type Preview
	} from './lifecycle';
	import PlacementFailures from './PlacementFailures.svelte';
	import type { Deployment } from './queries';
	import ConfigurationFields from './ConfigurationFields.svelte';
	import {
		fieldProblems,
		initialValues,
		settingsFromValues,
		type SettingValues
	} from './configuration-form';
	import { deployForm } from './stage';
	import { deviceName, imageDigest, shortDigest, type UpdateTarget } from './view';

	type Props = {
		open: boolean;
		action: LifecycleAction;
		/** The live deployment; the dialog keeps the revision it was opened with. */
		deployment: Deployment;
		/** Retained versions to update to, newest first. */
		targets: UpdateTarget[];
		/** A newer version published upstream that is not retained yet. */
		published?: string;
		/** Viewers can preview changes, but only administrators apply them. */
		canApply: boolean;
		/** Reloads the deployment, resolving once the new state is shown. */
		onReload: () => Promise<unknown>;
		onApplied: (change: AppliedChange) => void;
	};

	let {
		open = $bindable(false),
		action,
		deployment,
		targets,
		published,
		canApply,
		onReload,
		onApplied
	}: Props = $props();

	const api = getApi();
	const formId = $props.id();

	let step = $state<'choose' | 'review'>('review');
	let version = $state<string | undefined>();
	let revision = $state(0);
	let preview = $state<Preview | null>(null);
	let problem = $state<ActionProblem | null>(null);
	let previewing = $state(false);
	let applying = $state(false);
	let originalStopped = $state(false);
	/** Update with settings edited for the target version, instead of the current ones. */
	let changeSettings = $state(false);
	let values = $state<SettingValues>({});
	let settingsAttempted = $state(false);
	// Only the answer to the latest preview request is shown.
	let request = 0;

	// The target version's form, resolved for this device and the target it was staged with.
	const settingsForm = createQuery(() => ({
		queryKey: ['deployments', 'update-form', deployment.nodeId, version, deployment.inheritsSite],
		queryFn: () =>
			deployForm(
				api,
				{ driverId: deployment.driverId, version: version ?? deployment.version },
				{
					inheritSite: deployment.inheritsSite,
					nodeId: deployment.nodeId,
					settings: deployment.settings
				}
			),
		enabled: open && action === 'update' && changeSettings && version !== undefined
	}));
	// Start from the current settings each time another version's form arrives.
	$effect(() => {
		const data = settingsForm.data;
		if (data) untrack(() => (values = initialValues(data, deployment.settings)));
	});
	const reportedSettings = $derived(
		problem?.kind === 'settings'
			? problem.fields
			: (settingsForm.data?.validation.errors.filter((error) => error.code !== 'unknown_input') ??
					[])
	);
	const settingProblems = $derived(
		settingsForm.data ? fieldProblems(settingsForm.data, values, reportedSettings) : new Map()
	);

	$effect(() => {
		if (open) untrack(begin);
	});

	function begin() {
		preview = problem = null;
		originalStopped = applying = changeSettings = settingsAttempted = false;
		revision = deployment.revision;
		if (action === 'update') {
			step = 'choose';
			version = (targets.find((target) => target.newer) ?? targets[0])?.version;
		} else {
			step = 'review';
			void runPreview();
		}
	}

	const name = $derived(deviceName(deployment));
	const needsConfirmation = $derived(action === 'start' && deployment.requiresOriginalStopped);
	const targetVersion = $derived(
		action === 'update'
			? (version ?? deployment.version)
			: action === 'rollback'
				? (deployment.previousVersion ?? deployment.version)
				: deployment.version
	);
	const blockedByPlacement = $derived(preview?.requested === 'running' && !preview.schedulable);
	const settled = $derived(problem?.kind === 'conflict' || problem?.kind === 'uncertain');
	const canSubmit = $derived(
		canApply &&
			preview !== null &&
			!blockedByPlacement &&
			!settled &&
			(!needsConfirmation || originalStopped)
	);
	const imageChanged = $derived(
		preview !== null && imageDigest(preview.image) !== imageDigest(deployment.image)
	);

	const titles: Record<LifecycleAction, (input: { name: string }) => string> = {
		start: m.action_title_start,
		stop: m.action_title_stop,
		update: m.action_title_update,
		rollback: m.action_title_rollback
	};

	function input(): ActionInput {
		return {
			nodeId: deployment.nodeId,
			revision,
			version: action === 'update' ? version : undefined,
			settings:
				action === 'update' && changeSettings && settingsForm.data
					? settingsFromValues(settingsForm.data, values)
					: undefined,
			originalStopped: needsConfirmation ? originalStopped : undefined
		};
	}

	async function runPreview() {
		const id = ++request;
		previewing = true;
		preview = problem = null;
		try {
			const result = await previewAction(api, action, input());
			if (id === request) preview = result;
		} catch (error) {
			if (id === request) problem = actionProblem(error, 'preview');
		} finally {
			if (id === request) previewing = false;
		}
	}

	function review(event: SubmitEvent) {
		event.preventDefault();
		if (!version) return;
		if (changeSettings) {
			settingsAttempted = true;
			// Problems the manager reported are rechecked by the preview itself.
			if (!settingsForm.data || fieldProblems(settingsForm.data, values).size) return;
		}
		step = 'review';
		void runPreview();
	}

	/** Back to choosing; after a settings refusal, straight to the settings it needs. */
	function back() {
		if (problem?.kind === 'settings') {
			changeSettings = settingsAttempted = true;
		}
		step = 'choose';
	}

	/** After a conflict: show the current state and plan against it. */
	async function reviewCurrent() {
		previewing = true;
		await onReload();
		revision = deployment.revision;
		await runPreview();
	}

	async function closeAndReload() {
		open = false;
		await onReload();
	}

	async function apply() {
		applying = true;
		problem = null;
		try {
			const submission = await applyAction(api, action, input());
			open = false;
			onApplied({ action, submission, version: targetVersion });
		} catch (error) {
			problem = actionProblem(error, 'apply');
		} finally {
			applying = false;
		}
	}
</script>

{#snippet change(from: string, to: string)}
	{#if from === to}
		<span>{to}</span>
		<span class="unchanged">{m.preview_unchanged()}</span>
	{:else}
		<span>{from}</span>
		<ArrowRight size={14} aria-hidden="true" />
		<span class="visually-hidden">{m.preview_changes_to()}</span>
		<span class="changed">{to}</span>
	{/if}
{/snippet}

<Dialog bind:open title={titles[action]({ name })} description={m.preview_description()} width="md">
	{#if step === 'choose'}
		<form id={formId} class="stack" onsubmit={review}>
			{#if targets.length}
				<fieldset class="versions">
					<legend>{m.update_choose_legend({ driver: deployment.driverId })}</legend>
					{#each targets as target (target.version)}
						<label class="option">
							<input type="radio" name="version" value={target.version} bind:group={version} />
							<span class="mono">{target.version}</span>
							{#if target.newer}
								<Badge tone="accent">{m.update_newer()}</Badge>
							{:else}
								<Badge>{m.update_older()}</Badge>
							{/if}
							{#if target.origin === 'customer'}<Badge>{m.update_customer_build()}</Badge>{/if}
						</label>
					{/each}
				</fieldset>
			{:else}
				<Callout title={m.update_none_title()}>
					{m.update_none_body({ driver: deployment.driverId })}
				</Callout>
			{/if}
			{#if published}
				<Callout title={m.update_published_title({ version: published })}>
					{m.update_published_body()}
				</Callout>
			{/if}
			{#if targets.length}
				<Checkbox bind:checked={changeSettings} hint={m.update_change_configuration_hint()}>
					{m.update_change_configuration()}
				</Checkbox>
			{/if}
			{#if changeSettings && version}
				{#if settingsForm.error}
					<Callout tone="fail" title={m.stage_form_error()} live>
						{settingsForm.error.message}
					</Callout>
				{:else if !settingsForm.data}
					<Loading label={m.stage_form_loading()} />
				{:else}
					<fieldset class="settings">
						<legend>{m.update_configuration_legend({ version })}</legend>
						{#if problem?.kind === 'settings'}
							<Callout tone="fail" title={problem.message} live />
						{/if}
						<ConfigurationFields
							form={settingsForm.data}
							bind:values
							problems={settingProblems}
							showProblems={settingsAttempted}
							variable={`nomad/jobs/driverhub-${deployment.nodeId}`}
						/>
					</fieldset>
				{/if}
			{:else}
				<p class="note">{m.update_configuration_note()}</p>
			{/if}
		</form>
	{:else}
		<div class="stack">
			{#if previewing}
				<Loading label={m.preview_loading()} />
			{:else if preview}
				<Facts>
					<dt>{m.preview_version()}</dt>
					<dd class="mono">{@render change(deployment.version, targetVersion)}</dd>
					<dt>{m.preview_requested()}</dt>
					<dd>
						{@render change(
							deployment.requested === 'running' ? m.requested_running() : m.requested_stopped(),
							preview.requested === 'running' ? m.requested_running() : m.requested_stopped()
						)}
					</dd>
					<dt>{m.preview_image()}</dt>
					<dd class="mono">
						{#if imageChanged}
							{@render change(
								shortDigest(imageDigest(deployment.image)),
								shortDigest(imageDigest(preview.image))
							)}
						{:else}
							<span>{shortDigest(imageDigest(preview.image))}</span>
							<span class="unchanged">{m.preview_unchanged()}</span>
						{/if}
					</dd>
					{#if preview.requested === 'running'}
						<dt>{m.preview_placement()}</dt>
						<dd>
							{#if preview.schedulable}
								<span class="ok">{m.preview_schedulable()}</span>
							{:else}
								<span class="fail">{m.preview_not_schedulable()}</span>
							{/if}
						</dd>
					{/if}
				</Facts>

				{#if preview.placementFailures.length}
					<Callout tone="fail" title={m.preview_placement_failures()}>
						<PlacementFailures failures={preview.placementFailures} />
					</Callout>
				{/if}

				{#if action === 'start'}
					{#if needsConfirmation}
						<Callout tone="warn" title={m.consequence_migration_title()}>
							{m.consequence_migration_body()}
						</Callout>
						{#if canApply}
							<Checkbox bind:checked={originalStopped} hint={m.confirm_original_stopped_hint()}>
								{m.confirm_original_stopped()}
							</Checkbox>
						{/if}
					{:else}
						<Callout>{m.consequence_start()}</Callout>
					{/if}
				{:else if action === 'stop'}
					<Callout tone="warn" title={m.consequence_stop_title()}>
						<p>{m.consequence_stop_body()}</p>
						<p>{m.consequence_stop_migration()}</p>
					</Callout>
				{:else if action === 'update'}
					<Callout>{m.consequence_update({ version: targetVersion })}</Callout>
				{:else}
					<Callout>{m.consequence_rollback({ version: targetVersion })}</Callout>
				{/if}
			{/if}

			{#if problem}
				<Callout
					tone={problem.kind === 'conflict' || problem.kind === 'uncertain' ? 'warn' : 'fail'}
					title={problem.message}
					live
				>
					{#if problem.kind === 'settings' && problem.fields.length}
						<ul class="fields">
							{#each problem.fields as field (field.field)}
								<li><code>{field.field}</code> {settingsErrorText(field.code)}</li>
							{/each}
						</ul>
						<p>{m.action_problem_configuration_next()}</p>
					{:else if problem.kind === 'placement' && problem.failures.length}
						<PlacementFailures failures={problem.failures} />
					{/if}
				</Callout>
			{/if}

			{#if !canApply && !previewing}
				<p class="note">{m.preview_viewer_note()}</p>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		{#if step === 'choose'}
			<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
			<Button variant="primary" type="submit" form={formId} disabled={!version}>
				{m.update_preview()}
			</Button>
		{:else}
			{#if action === 'update'}
				<Button variant="ghost" class="back" onclick={back}>
					{problem?.kind === 'settings' ? m.update_fix_configuration() : m.common_back()}
				</Button>
			{/if}
			<Button variant="ghost" onclick={() => (open = false)}>
				{canApply ? m.common_cancel() : m.common_close()}
			</Button>
			{#if problem?.kind === 'conflict'}
				<Button variant="primary" onclick={reviewCurrent} busy={previewing}>
					{m.action_review_current()}
				</Button>
			{:else if problem?.kind === 'uncertain'}
				<Button variant="primary" onclick={closeAndReload}>{m.action_close_reload()}</Button>
			{:else if !preview && problem?.kind === 'other' && !previewing}
				<Button onclick={runPreview}>{m.preview_again()}</Button>
			{:else if canApply && (preview || previewing)}
				<Button
					variant={action === 'stop' ? 'danger' : 'primary'}
					disabled={!canSubmit}
					busy={applying}
					onclick={apply}
				>
					{action === 'start'
						? m.action_apply_start()
						: action === 'stop'
							? m.action_apply_stop()
							: action === 'update'
								? m.action_apply_update({ version: targetVersion })
								: m.action_apply_rollback({ version: targetVersion })}
				</Button>
			{/if}
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
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
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

	.versions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: var(--space-2);
		font-weight: var(--weight-semibold);
	}

	.option {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		box-shadow: inset 0 0 0 1px var(--border-strong);
		cursor: pointer;
	}

	.option:has(input:checked) {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px var(--accent);
	}

	.option input {
		margin: 0;
		accent-color: var(--accent);
	}

	.option:has(input:focus-visible) {
		box-shadow:
			inset 0 0 0 1px var(--accent),
			0 0 0 3px var(--accent-soft);
	}

	.option input:focus-visible {
		outline: none;
	}

	.note {
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	.unchanged {
		color: var(--text-3);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
	}

	.changed {
		font-weight: var(--weight-semibold);
	}

	.ok {
		color: var(--ok);
		font-weight: var(--weight-semibold);
	}

	.fail {
		color: var(--fail);
		font-weight: var(--weight-semibold);
	}

	.fields {
		margin: var(--space-1) 0 var(--space-2);
		padding-left: var(--space-5);
	}

	:global(.dialog-footer .back) {
		margin-right: auto;
	}
</style>
