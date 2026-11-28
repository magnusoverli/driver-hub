<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { getApi } from '#lib/api/context.js';
	import { m } from '#lib/paraglide/messages.js';
	import {
		capabilitiesQuery,
		imageDistributionQuery,
		nomadConnectionQuery
	} from '#lib/system/queries.js';
	import { siteReadiness } from '#lib/system/readiness.js';
	import ReadinessList from '#lib/system/ReadinessList.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';

	const api = getApi();
	const capabilities = createQuery(() => capabilitiesQuery(api));
	const nomad = createQuery(() => nomadConnectionQuery(api));
	const images = createQuery(() => imageDistributionQuery(api));

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
</script>

<PageHeader title={m.nav_site_setup()} description={m.site_setup_description()} />

{#if capabilities.error}
	<Callout tone="fail" title={m.overview_error_title()} live>{capabilities.error.message}</Callout>
{:else if settled && attention > 0}
	<Callout tone="warn" title={m.overview_attention_title({ count: attention })}>
		{m.overview_attention_admin()}
	</Callout>
{:else if settled}
	<Callout tone="ok" title={m.site_setup_ready()} />
{/if}

<Card title={m.readiness_title()} description={m.readiness_description()} flush>
	<ReadinessList {items} showSettings />
</Card>
