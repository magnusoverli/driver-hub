<script lang="ts">
	import { untrack } from 'svelte';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { getApi } from '#lib/api/context.js';
	import { deploymentKeys } from '#lib/deployments/queries.js';
	import { m } from '#lib/paraglide/messages.js';
	import { siteProblem, type SiteProblem } from '#lib/site/problems.js';
	import {
		canKeepNomadToken,
		configureNomad,
		datacentersProblem,
		environmentQuery,
		namespaceProblem,
		nomadInput,
		isRemotePlainHttp,
		nomadOrigin,
		revisionFor,
		siteKeys,
		siteQuery,
		type NomadTokenChoice,
		type Site
	} from '#lib/site/settings.js';
	import { nomadConnectionQuery, systemKeys } from '#lib/system/queries.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import HelpTip from '#lib/ui/HelpTip.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import ImageDistributionCard from '#lib/system/ImageDistributionCard.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import RadioGroup from '#lib/ui/RadioGroup.svelte';
	import TextField from '#lib/ui/TextField.svelte';

	const api = getApi();
	const queryClient = useQueryClient();
	const site = createQuery(() => siteQuery(api));
	const environment = createQuery(() => environmentQuery(api));
	const downloadOverride = $derived(
		environment.data?.find((entry) => entry.name === 'DRIVER_HUB_DISTRIBUTION_ADDRESS')?.value
	);
	const connection = createQuery(() => nomadConnectionQuery(api));

	let address = $state('');
	let distributionAddress = $state('');
	let namespace = $state('default');
	let datacenters = $state('dc1');
	let tokenChoice = $state<NomadTokenChoice>('replace');
	let token = $state('');
	let plainHttp = $state(false);
	/** The settings the form was filled from; saving against them detects concurrent changes. */
	let basis = $state<Site | null>(null);
	let attempted = $state(false);
	let busy = $state(false);
	let problem = $state<SiteProblem | null>(null);
	let saved = $state(false);

	function fill(settings: Site) {
		address = settings.nomad.address ?? '';
		distributionAddress = settings.nomad.distributionAddress ?? '';
		namespace = settings.nomad.namespace;
		datacenters = settings.nomad.datacenters.join(', ');
		tokenChoice = settings.nomad.tokenConfigured
			? 'keep'
			: settings.nomad.address
				? 'none'
				: 'replace';
		token = '';
		plainHttp = settings.nomad.plainHttp;
		basis = settings;
		attempted = false;
	}

	$effect(() => {
		const settings = site.data;
		if (settings && basis === null) untrack(() => fill(settings));
	});

	const origin = $derived(nomadOrigin(address));
	// Only a token on its way to another machine over plain HTTP needs the operator's permission.
	const remotePlain = $derived(isRemotePlainHttp(origin));
	const sendsToken = $derived(tokenChoice !== 'none');
	const keepAvailable = $derived(
		site.data ? canKeepNomadToken(site.data, origin, namespace) : false
	);
	// A token is only kept for the cluster and namespace it was saved for.
	$effect(() => {
		if (!keepAvailable && tokenChoice === 'keep') untrack(() => (tokenChoice = 'replace'));
	});
	const targetChanges = $derived(
		Boolean(site.data?.nomad.address) &&
			origin !== null &&
			(origin !== site.data?.nomad.address || namespace.trim() !== site.data?.nomad.namespace)
	);

	const addressError = $derived(attempted && !origin ? m.nomad_error_address() : null);
	const namespaceError = $derived(attempted ? namespaceProblem(namespace) : null);
	const datacentersError = $derived(attempted ? datacentersProblem(datacenters) : null);
	const plainHttpError = $derived(
		attempted && remotePlain && sendsToken && !plainHttp ? m.nomad_error_plain_http() : null
	);
	const tokenError = $derived(
		attempted && tokenChoice === 'replace' && !token.trim() ? m.nomad_error_token() : null
	);

	const tokenOptions = $derived([
		{
			value: 'keep' as const,
			label: m.nomad_token_keep(),
			description: keepAvailable
				? m.nomad_token_keep_description()
				: m.nomad_token_keep_unavailable(),
			disabled: !keepAvailable
		},
		{ value: 'replace' as const, label: m.nomad_token_replace() },
		{
			value: 'none' as const,
			label: m.nomad_token_none(),
			description: m.nomad_token_none_description()
		}
	]);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		problem = null;
		saved = false;
		if (!origin || namespaceProblem(namespace) || datacentersProblem(datacenters)) return;
		if (tokenChoice === 'replace' && !token.trim()) return;
		if (remotePlain && sendsToken && !plainHttp) return;
		if (!basis || !site.data) return;
		busy = true;
		try {
			const result = await configureNomad(
				api,
				nomadInput(revisionFor(basis, site.data, 'nomad'), {
					address,
					distributionAddress: downloadOverride ? undefined : distributionAddress,
					namespace,
					datacenters,
					tokenChoice,
					token,
					plainHttp: remotePlain && plainHttp
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
				const fresh = await site.refetch();
				if (fresh.data) fill(fresh.data);
			}
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={m.nav_nomad()} description={m.nomad_description()} />

{#if site.error}
	<Callout tone="fail" title={m.site_error_title()} live>{site.error.message}</Callout>
{:else if !site.data}
	<Card><Loading label={m.site_loading()} /></Card>
{:else}
	<!-- One form: the connection, and the address clients download images from. -->
	<form class="stack" onsubmit={submit} novalidate>
		<Card title={m.nomad_connection_title()} description={m.nomad_form_description()}>
			{#snippet actions()}
				<span class="state">
					{#if connection.error}
						<Badge tone="fail">{m.nomad_state_error()}</Badge>
					{:else if connection.data?.state === 'connected'}
						<Badge tone="ok">{m.nomad_state_connected()}</Badge>
					{:else if connection.data?.state === 'no_leader'}
						<Badge tone="warn">{m.nomad_state_no_leader()}</Badge>
					{:else if connection.data}
						<Badge>{m.nomad_state_not_configured()}</Badge>
					{/if}
					<HelpTip label={m.nomad_state()} help={m.nomad_current_note()} />
				</span>
			{/snippet}
			<div class="form">
				{#if connection.error}
					<Callout tone="fail" live>{connection.error.message}</Callout>
				{/if}
				{#if saved}<Callout tone="ok" title={m.nomad_saved()} live />{/if}
				{#if problem}
					<Callout tone={problem.kind === 'conflict' ? 'warn' : 'fail'} live>
						{problem.message}
					</Callout>
				{/if}
				<TextField
					label={m.nomad_address()}
					bind:value={address}
					placeholder="nomad.site.example"
					autocomplete="off"
					spellcheck={false}
					hint={origin ? m.nomad_address_resolved({ origin }) : m.nomad_address_hint()}
					error={addressError}
				/>
				<div class="pair">
					<TextField
						label={m.nomad_namespace()}
						bind:value={namespace}
						autocomplete="off"
						spellcheck={false}
						error={namespaceError}
					/>
					<TextField
						label={m.nomad_datacenters()}
						bind:value={datacenters}
						autocomplete="off"
						spellcheck={false}
						hint={m.nomad_datacenters_hint()}
						error={datacentersError}
					/>
				</div>
				<RadioGroup legend={m.nomad_token()} options={tokenOptions} bind:value={tokenChoice} />
				{#if tokenChoice === 'replace'}
					<TextField
						label={m.nomad_token_field()}
						type="password"
						autocomplete="off"
						bind:value={token}
						hint={m.nomad_token_field_hint()}
						error={tokenError}
					/>
				{/if}
				{#if remotePlain && sendsToken}
					<Checkbox bind:checked={plainHttp} hint={m.nomad_plain_http_hint()}>
						{m.nomad_plain_http()}
					</Checkbox>
					{#if plainHttpError}<Callout tone="fail" live>{plainHttpError}</Callout>{/if}
				{/if}
				{#if targetChanges && site.data.videoipath.url}
					<Callout tone="warn" title={m.nomad_target_change_title()}>
						{m.nomad_target_change_body()}
					</Callout>
				{/if}
			</div>
		</Card>

		<ImageDistributionCard>
			{#if downloadOverride}
				<TextField
					label={m.nomad_download_address()}
					value={downloadOverride}
					readonly
					hint={m.nomad_download_override()}
				/>
			{:else}
				<TextField
					label={m.nomad_download_address()}
					bind:value={distributionAddress}
					placeholder={m.nomad_download_auto()}
					autocomplete="off"
					spellcheck={false}
					hint={m.nomad_download_hint()}
				/>
			{/if}
		</ImageDistributionCard>

		<div class="submit">
			<Button variant="primary" type="submit" {busy}>{m.nomad_submit()}</Button>
			<span class="note">{m.nomad_submit_note()}</span>
		</div>
	</form>
{/if}

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		max-width: 52rem;
	}

	.state {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
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
