<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { getApi } from '#lib/api/context.js';
	import { m } from '#lib/paraglide/messages.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { capabilitiesQuery, nomadConnectionQuery } from '#lib/system/queries.js';
	import { siteReadiness } from '#lib/system/readiness.js';
	import ReadinessList from '#lib/system/ReadinessList.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Freshness from '#lib/ui/Freshness.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';

	const api = getApi();
	const session = getSession();
	const capabilities = createQuery(() => capabilitiesQuery(api));
	const nomad = createQuery(() => nomadConnectionQuery(api));

	const items = $derived(
		siteReadiness({ capabilities: capabilities.data, nomad: nomad.data, nomadError: nomad.error })
	);
	const attention = $derived(items.filter((item) => item.state === 'attention').length);
	const settled = $derived(items.every((item) => item.state !== 'checking'));
	const updatedAt = $derived(Math.min(capabilities.dataUpdatedAt, nomad.dataUpdatedAt));
</script>

<PageHeader title={m.overview_title()} description={m.overview_description()}>
	{#snippet meta()}
		<Freshness {updatedAt} fetching={capabilities.isFetching || nomad.isFetching} />
	{/snippet}
</PageHeader>

{#if capabilities.error}
	<Callout tone="fail" title={m.overview_error_title()} live>{capabilities.error.message}</Callout>
{:else if settled}
	{#if attention > 0}
		<Callout tone="warn" title={m.overview_attention_title({ count: attention })}>
			{session.isAdmin ? m.overview_attention_admin() : m.overview_attention_viewer()}
		</Callout>
	{:else}
		<Callout tone="ok" title={m.overview_ready_title()}>{m.overview_ready_body()}</Callout>
	{/if}
{/if}

<div class="grid">
	<Card title={m.readiness_title()} description={m.readiness_description()} flush>
		<ReadinessList {items} showSettings={session.isAdmin} />
	</Card>
	<Card title={m.access_title()}>
		<dl class="access">
			<dt>{m.access_signed_in_as()}</dt>
			<dd>{session.operator?.username}</dd>
			<dt>{m.access_role()}</dt>
			<dd>{session.isAdmin ? m.role_admin() : m.role_viewer()}</dd>
		</dl>
		<p class="access-note">{session.isAdmin ? m.access_admin_note() : m.access_viewer_note()}</p>
	</Card>
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
		align-items: start;
		gap: var(--space-5);
	}

	@media (max-width: 60rem) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.access {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-2) var(--space-4);
	}

	dt {
		color: var(--text-3);
	}

	dd {
		font-weight: var(--weight-semibold);
	}

	.access-note {
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
