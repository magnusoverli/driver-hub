<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Facts from '#lib/ui/Facts.svelte';

	const repo = 'https://github.com/magnusoverli/driver-hub';
	const version = import.meta.env.VITE_DRIVER_HUB_VERSION;
	const revision = import.meta.env.VITE_DRIVER_HUB_REVISION;
</script>

<svelte:head><title>{m.about_title()}</title></svelte:head>
<PageHeader title={m.about_title()} description={m.about_description()} />
<Card title={m.about_build()}>
	<Facts>
		<dt>{m.about_version()}</dt>
		<dd>{version || m.about_local()}</dd>
		{#if revision}
			<dt>{m.about_revision()}</dt>
			<dd><a href={`${repo}/commit/${revision}`}><code>{revision.slice(0, 12)}</code></a></dd>
		{/if}
	</Facts>
</Card>
<Card title={m.about_links()}>
	<ul>
		<li>
			<a href={version ? `${repo}/releases/tag/${version}` : `${repo}/releases`}>
				{m.about_notes()}
			</a>
		</li>
		<li><a href={`${repo}/blob/${revision || 'main'}/OPERATIONS.md`}>{m.about_operations()}</a></li>
	</ul>
</Card>
