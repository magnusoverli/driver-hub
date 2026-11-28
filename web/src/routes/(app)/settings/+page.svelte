<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { retainedQuery } from '#lib/catalog/queries.js';
	import { deploymentsQuery } from '#lib/deployments/queries.js';
	import { m } from '#lib/paraglide/messages.js';
	import {
		capabilitiesQuery,
		imageDistributionQuery,
		nomadConnectionQuery
	} from '#lib/system/queries.js';
	import { siteReadiness } from '#lib/system/readiness.js';
	import ReadinessList from '#lib/system/ReadinessList.svelte';
	import SetupChecklist, { type SetupStep } from '#lib/system/SetupChecklist.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';

	const api = getApi();
	const capabilities = createQuery(() => capabilitiesQuery(api));
	const nomad = createQuery(() => nomadConnectionQuery(api));
	const images = createQuery(() => imageDistributionQuery(api));
	const cluster = $derived(capabilities.data?.nomadConfigured === true);
	const retained = createQuery(() => retainedQuery(api));
	const deployments = createQuery(() => ({ ...deploymentsQuery(api), enabled: cluster }));

	const items = $derived(
		siteReadiness({
			capabilities: capabilities.data,
			nomad: nomad.data,
			nomadError: nomad.error,
			images: images.data,
			imagesError: images.error
		})
	);
	const attention = $derived(items.filter((item) => item.state === 'attention').length);
	const settled = $derived(items.every((item) => item.state !== 'checking'));

	const connected = $derived(cluster && nomad.data?.state === 'connected');
	const downloaded = $derived((retained.data?.length ?? 0) > 0);
	const hasDevice = $derived((deployments.data?.length ?? 0) > 0);
	// The path from an empty site to a first device, until the site has one.
	const steps = $derived<SetupStep[]>([
		{
			id: 'nomad',
			title: m.setup_nomad_title(),
			detail: m.setup_nomad_detail(),
			done: connected,
			action: { label: m.setup_nomad_action(), href: resolve('/(app)/settings/nomad') }
		},
		{
			id: 'videoipath',
			title: m.setup_videoipath_title(),
			detail: m.setup_videoipath_detail(),
			done: capabilities.data?.videoIPathConfigured === true,
			action: { label: m.setup_videoipath_action(), href: resolve('/(app)/settings/videoipath') }
		},
		{
			id: 'download',
			title: m.setup_download_title(),
			detail: m.setup_download_detail(),
			done: downloaded,
			action: { label: m.setup_download_action(), href: resolve('/(app)/catalog') }
		},
		{
			id: 'device',
			title: m.setup_device_title(),
			detail: connected && downloaded ? m.setup_device_detail() : m.setup_device_blocked(),
			done: hasDevice,
			action: {
				label: m.devices_add(),
				href: resolve('/(app)/devices/new'),
				disabled: !connected || !downloaded
			}
		}
	]);
	const loaded = $derived(
		capabilities.data !== undefined &&
			retained.data !== undefined &&
			(!cluster || deployments.data !== undefined || deployments.error !== null)
	);
	const finished = $derived(
		connected && capabilities.data?.videoIPathConfigured === true && downloaded && hasDevice
	);
</script>

<PageHeader title={m.nav_site_setup()} description={m.site_setup_description()} />

{#if capabilities.error}
	<Callout tone="fail" title={m.overview_error_title()} live>{capabilities.error.message}</Callout>
{:else if settled && attention > 0}
	<Callout tone="warn" title={m.overview_attention_title({ count: attention })}>
		{m.overview_attention_admin()}
	</Callout>
{/if}

{#if loaded && !finished}
	<Card title={m.setup_title()} description={m.setup_description()} flush>
		<SetupChecklist {steps} />
	</Card>
{:else if loaded && settled && attention === 0}
	<Callout tone="ok" title={m.site_setup_ready()} />
{/if}

<Card title={m.readiness_title()} description={m.readiness_description()} flush>
	<ReadinessList {items} showSettings />
</Card>
