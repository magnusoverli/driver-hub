<script lang="ts">
	import { untrack } from 'svelte';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { getApi } from '#lib/api/context.js';
	import { ApiError } from '#lib/api/errors.js';
	import { m } from '#lib/paraglide/messages.js';
	import {
		environmentLabel,
		environmentSource,
		environmentValue
	} from '#lib/site/environment-labels.js';
	import { siteProblem, type SiteProblem } from '#lib/site/problems.js';
	import {
		configureManager,
		environmentQuery,
		revisionFor,
		siteKeys,
		siteQuery,
		type Site
	} from '#lib/site/settings.js';
	import { systemKeys } from '#lib/system/queries.js';
	import Badge from '#lib/ui/Badge.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Card from '#lib/ui/Card.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import PageHeader from '#lib/ui/PageHeader.svelte';
	import Table from '#lib/ui/Table.svelte';

	const api = getApi();
	const queryClient = useQueryClient();
	const site = createQuery(() => siteQuery(api));
	const environment = createQuery(() => environmentQuery(api));

	let buildsEnabled = $state(false);
	let timings = $state(false);
	let basis = $state<Site | null>(null);
	let busy = $state(false);
	let problem = $state<SiteProblem | null>(null);
	let saved = $state(false);

	function fill(settings: Site) {
		buildsEnabled = settings.manager.buildsEnabled;
		timings = settings.manager.timings;
		basis = settings;
	}

	$effect(() => {
		const settings = site.data;
		if (settings && basis === null) untrack(() => fill(settings));
	});

	// Builds cannot be turned on where the manager cannot run them, but can always be turned off.
	const buildsLocked = $derived(
		site.data ? !site.data.manager.buildsAvailable && !buildsEnabled : true
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		problem = null;
		saved = false;
		if (!basis || !site.data) return;
		busy = true;
		try {
			const result = await configureManager(api, {
				revision: revisionFor(basis, site.data, 'manager'),
				buildsEnabled,
				timings
			});
			queryClient.setQueryData(siteKeys.settings(), result);
			fill(result);
			saved = true;
			void queryClient.invalidateQueries({ queryKey: systemKeys.all });
		} catch (error) {
			problem =
				error instanceof ApiError && error.code === 'builds_unavailable'
					? { kind: 'other', message: m.manager_error_builds_unavailable() }
					: siteProblem(error);
			if (problem.kind === 'conflict') {
				const fresh = await site.refetch();
				if (fresh.data) fill(fresh.data);
			}
		} finally {
			busy = false;
		}
	}
</script>

<PageHeader title={m.nav_manager()} description={m.manager_description()} />

{#if site.error}
	<Callout tone="fail" title={m.site_error_title()} live>{site.error.message}</Callout>
{:else if !site.data}
	<Card><Loading label={m.site_loading()} /></Card>
{:else}
	<div class="layout">
		<Card title={m.manager_features_title()} description={m.manager_features_description()}>
			<form class="form" onsubmit={submit} novalidate>
				{#if saved}<Callout tone="ok" title={m.manager_saved()} live />{/if}
				{#if problem}
					<Callout tone={problem.kind === 'conflict' ? 'warn' : 'fail'} live>
						{problem.message}
					</Callout>
				{/if}
				<Checkbox
					bind:checked={buildsEnabled}
					disabled={buildsLocked}
					hint={site.data.manager.buildsAvailable
						? m.manager_builds_hint()
						: m.manager_builds_unavailable()}
				>
					{m.manager_builds()}
				</Checkbox>
				<Checkbox bind:checked={timings} hint={m.manager_timings_hint()}>
					{m.manager_timings()}
				</Checkbox>
				<div class="submit">
					<Button variant="primary" type="submit" {busy}>{m.manager_submit()}</Button>
				</div>
			</form>
		</Card>

		<Card
			title={m.manager_environment_title()}
			description={m.manager_environment_description()}
			flush
		>
			{#if environment.error}
				<div class="inset">
					<Callout tone="fail" title={m.manager_environment_error()} live>
						{environment.error.message}
					</Callout>
				</div>
			{:else if !environment.data}
				<Loading label={m.manager_environment_loading()} />
			{:else}
				<Table label={m.manager_environment_label()}>
					<thead>
						<tr>
							<th scope="col">{m.manager_environment_setting()}</th>
							<th scope="col">{m.manager_environment_value()}</th>
							<th scope="col">{m.manager_environment_source()}</th>
						</tr>
					</thead>
					<tbody>
						{#each environment.data as setting (setting.name)}
							{@const value = environmentValue(setting)}
							<tr>
								<td>
									<span class="setting">{environmentLabel(setting.name)}</span>
									<code class="variable">{setting.name}</code>
								</td>
								<td>
									{#if value === null}{m.manager_source_unset()}
									{:else if setting.secret}{value}
									{:else}<code class="value">{value}</code>{/if}
								</td>
								<td>
									{#if setting.source === 'environment'}
										<Badge tone="accent">{environmentSource(setting)}</Badge>
									{:else}
										{environmentSource(setting)}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<p class="inset how">{m.manager_environment_how()}</p>
			{/if}
		</Card>
	</div>
{/if}

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(18rem, 1fr) minmax(0, 1.8fr);
		align-items: start;
		gap: var(--space-5);
	}

	@media (max-width: 68rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.submit {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.setting {
		display: block;
		font-weight: var(--weight-semibold);
	}

	.variable,
	.value {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.variable {
		color: var(--text-2);
	}

	.inset {
		padding: var(--space-3) var(--space-4);
	}

	.how {
		border-top: 1px solid var(--border);
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
