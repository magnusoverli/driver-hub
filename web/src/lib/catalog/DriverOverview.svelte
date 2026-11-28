<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { fieldLabel } from '#lib/deployments/configuration-form.js';
	import { m } from '#lib/paraglide/messages.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import { inputSource, requiredOperatorInputs } from './declaration';
	import { releaseQuery, type Identity } from './queries';

	/** What a driver needs and offers, from the version the catalog offers first. */
	let { release, downloaded }: { release: Identity; downloaded: boolean } = $props();

	const api = getApi();
	const detail = createQuery(() =>
		releaseQuery(api, downloaded ? 'retained' : 'published', release)
	);
	const declaration = $derived(detail.data?.configuration);
	const required = $derived(declaration ? requiredOperatorInputs(declaration) : []);
	const optional = $derived(
		declaration
			? declaration.inputs.filter(
					(input) =>
						(!input.required || input.default !== undefined) &&
						inputSource(declaration, input) === 'operator'
				).length
			: 0
	);
	const connects = $derived(
		declaration
			? declaration.inputs.some((input) => inputSource(declaration, input) === 'site')
			: false
	);
</script>

<Card
	title={m.driver_overview_title()}
	description={m.driver_overview_description({ version: release.version })}
>
	{#if detail.error}
		<p class="muted">{errorMessage(detail.error)}</p>
	{:else if !detail.data || !declaration}
		<Loading label={m.catalog_loading()} />
	{:else}
		<Facts>
			<dt>{m.driver_overview_needs()}</dt>
			<dd>
				{#if required.length}
					<ul class="inputs">
						{#each required as input (input.name)}
							<li>
								<span>{fieldLabel(input.name)}</span>
								{#if input.secret}<Badge>{m.configuration_secret_reference()}</Badge>{/if}
								{#if input.description}<span class="muted">{input.description}</span>{/if}
							</li>
						{/each}
					</ul>
				{:else}
					{m.stage_no_required()}
				{/if}
				{#if optional}
					<span class="muted block">{m.driver_overview_optional({ count: optional })}</span>
				{/if}
			</dd>
			<dt>{m.stage_connection()}</dt>
			<dd>{connects ? m.driver_overview_site() : m.driver_overview_no_site()}</dd>
			<dt>{m.release_monitoring_title()}</dt>
			<dd>
				{#if declaration.controlHealth}
					<Badge tone="ok">{m.driver_overview_monitored()}</Badge>
				{:else}
					<Badge tone="warn">{m.driver_overview_not_monitored()}</Badge>
				{/if}
			</dd>
			<dt>{m.catalog_platform()}</dt>
			<dd><span class="mono">{detail.data.record.image.platforms.join(', ')}</span></dd>
		</Facts>
		<p class="more">
			<a
				href={resolve('/(app)/catalog/[driverId]/[version]', {
					driverId: release.driverId,
					version: release.version
				})}
			>
				{m.driver_overview_details()}
			</a>
		</p>
	{/if}
</Card>

<style>
	.inputs {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.inputs li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
	}

	.muted {
		color: var(--text-2);
		font-size: var(--text-sm);
	}

	.block {
		display: block;
		margin-top: var(--space-2);
	}

	.more {
		margin-top: var(--space-4);
		font-size: var(--text-sm);
	}
</style>
