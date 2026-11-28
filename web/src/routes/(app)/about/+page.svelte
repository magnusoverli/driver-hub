<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import { getSession } from '#lib/session/session.svelte.js';
	import { getApi } from '#lib/api/context.js';
	import { unwrap } from '#lib/api/client.js';
	import { createQuery } from '@tanstack/svelte-query';
	import HubUpdate from '#lib/system/HubUpdate.svelte';

	const repo = 'https://github.com/magnusoverli/driver-hub';
	const session = getSession(),
		api = getApi();
	const build = createQuery(() => ({
		queryKey: ['running-build'],
		queryFn: () => unwrap(api.GET('/build'))
	}));
	const version = $derived(
		build.data?.version === 'development' ? m.about_local() : build.data?.version
	);
	const revision = $derived(build.data?.revision);
</script>

<svelte:head><title>{m.about_title()}</title></svelte:head>
<PageHeader title={m.about_title()} description={m.about_description()} />
<Card title={m.about_build()}>
	<Facts>
		<dt>{m.about_version()}</dt>
		<dd>{version || '—'}</dd>
		{#if revision}
			<dt>{m.about_revision()}</dt>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external source repository -->
			<dd><a href={`${repo}/commit/${revision}`}><code>{revision.slice(0, 12)}</code></a></dd>
		{/if}
	</Facts>
</Card>
{#if session.isAdmin}<Card title={m.update_heading()}><HubUpdate about /></Card>{/if}
<Card title={m.about_links()}>
	<ul>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external operations guide -->
		<li><a href={`${repo}/blob/${revision || 'main'}/OPERATIONS.md`}>{m.about_operations()}</a></li>
	</ul>
</Card>
