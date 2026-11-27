<script lang="ts">
	import { untrack } from 'svelte';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { getApi } from '#lib/api/context.js';
	import { deploymentKeys } from '#lib/deployments/queries.js';
	import { m } from '#lib/paraglide/messages.js';
	import { systemKeys } from '#lib/system/queries.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import { siteProblem, type SiteProblem } from './problems';
	import {
		configureDeployment,
		deploymentInput,
		imageHostProblem,
		nomadUiOrigin,
		revisionFor,
		siteKeys,
		type Site
	} from './settings';

	type Props = {
		/** The current site settings. */
		site: Site;
		/** Fetches the site settings again, after a conflicting change. */
		reload: () => Promise<Site | undefined>;
	};

	let { site, reload }: Props = $props();

	const api = getApi();
	const queryClient = useQueryClient();

	let imageHost = $state('');
	let uiOrigin = $state('');
	let sharedWriters = $state(false);
	/** The settings the form was filled from, to detect changes made meanwhile. */
	let basis = $state<Site | null>(null);
	let attempted = $state(false);
	let busy = $state(false);
	let problem = $state<SiteProblem | null>(null);
	let saved = $state(false);

	function fill(settings: Site) {
		imageHost = settings.deployment.imageHost ?? '';
		uiOrigin = settings.deployment.nomadUiOrigin ?? '';
		sharedWriters = settings.deployment.sharedWriters;
		basis = settings;
		attempted = false;
	}

	$effect(() => {
		if (basis === null) untrack(() => fill(site));
	});

	const imageHostError = $derived(attempted ? imageHostProblem(imageHost) : null);
	const uiOriginError = $derived(
		attempted && uiOrigin.trim() && !nomadUiOrigin(uiOrigin) ? m.nomad_error_ui_origin() : null
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		problem = null;
		saved = false;
		if (imageHostProblem(imageHost) || (uiOrigin.trim() && !nomadUiOrigin(uiOrigin))) return;
		if (!basis) return;
		busy = true;
		try {
			const result = await configureDeployment(
				api,
				deploymentInput(revisionFor(basis, site, 'deployment'), {
					imageHost,
					nomadUiOrigin: uiOrigin,
					sharedWriters
				})
			);
			queryClient.setQueryData(siteKeys.settings(), result);
			fill(result);
			saved = true;
			void queryClient.invalidateQueries({ queryKey: systemKeys.all });
			void queryClient.invalidateQueries({ queryKey: deploymentKeys.all });
		} catch (error) {
			problem = siteProblem(error);
			if (problem.kind === 'conflict') {
				const fresh = await reload();
				if (fresh) fill(fresh);
			}
		} finally {
			busy = false;
		}
	}
</script>

<Card title={m.nomad_jobs_title()} description={m.nomad_jobs_description()}>
	<form class="form" onsubmit={submit} novalidate>
		{#if saved}<Callout tone="ok" title={m.nomad_jobs_saved()} live />{/if}
		{#if problem}
			<Callout tone={problem.kind === 'conflict' ? 'warn' : 'fail'} live>
				{problem.message}
			</Callout>
		{/if}
		<TextField
			label={m.nomad_image_host()}
			bind:value={imageHost}
			placeholder="driver-images.site.example"
			autocomplete="off"
			spellcheck={false}
			hint={m.nomad_image_host_hint()}
			error={imageHostError}
		/>
		<TextField
			label={m.nomad_ui_origin()}
			bind:value={uiOrigin}
			placeholder="https://nomad.site.example"
			autocomplete="off"
			spellcheck={false}
			hint={m.nomad_ui_origin_hint()}
			error={uiOriginError}
		/>
		<Checkbox bind:checked={sharedWriters} hint={m.nomad_shared_writers_hint()}>
			{m.nomad_shared_writers()}
		</Checkbox>
		<div class="submit">
			<Button variant="primary" type="submit" {busy}>{m.nomad_jobs_submit()}</Button>
			<span class="note">{m.nomad_jobs_note()}</span>
		</div>
	</form>
</Card>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.submit {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.note {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
