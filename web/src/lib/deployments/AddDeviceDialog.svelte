<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { catalogDrivers } from '#lib/catalog/drivers.js';
	import { retainedQuery, type RetainedRelease } from '#lib/catalog/queries.js';
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/ui/Button.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Loading from '#lib/ui/Loading.svelte';
	import RadioGroup from '#lib/ui/RadioGroup.svelte';

	type Props = {
		open: boolean;
		/** Continues with setting up a device for the chosen release. */
		onChoose: (release: RetainedRelease) => void;
	};

	let { open = $bindable(), onChoose }: Props = $props();

	const api = getApi();
	const formId = $props.id();
	const retained = createQuery(() => ({ ...retainedQuery(api), enabled: open }));
	// The newest downloaded version of each driver; the driver's catalog page offers the others.
	const drivers = $derived(
		catalogDrivers({ published: [], retained: retained.data ?? [] }).filter(
			(driver) => driver.newestDownloaded?.retained
		)
	);
	let chosen = $state('');
	$effect(() => {
		if (!drivers.some((driver) => driver.driverId === chosen)) chosen = drivers[0]?.driverId ?? '';
	});
	const options = $derived(
		drivers.map((driver) => ({
			value: driver.driverId,
			label: driver.name,
			description: m.add_device_option({
				driver: driver.driverId,
				version: driver.newestDownloaded?.version ?? ''
			})
		}))
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const release = drivers.find((driver) => driver.driverId === chosen)?.newestDownloaded
			?.retained;
		if (!release) return;
		open = false;
		onChoose(release);
	}
</script>

<Dialog bind:open title={m.add_device_title()} description={m.add_device_description()} width="md">
	{#if retained.error}
		<Callout tone="fail" title={errorMessage(retained.error)} live />
	{:else if !retained.data}
		<Loading label={m.catalog_loading()} />
	{:else if !drivers.length}
		<Callout title={m.add_device_none_title()}>{m.add_device_none_body()}</Callout>
	{:else}
		<form id={formId} class="stack" onsubmit={submit}>
			<RadioGroup legend={m.add_device_legend()} {options} bind:value={chosen} />
			<p class="note">
				{m.add_device_other()}
				<a href={resolve('/(app)/catalog')} onclick={() => (open = false)}>
					{m.add_device_catalog_link()}
				</a>
			</p>
		</form>
	{/if}

	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
		{#if retained.data && !drivers.length}
			<Button variant="primary" href={resolve('/(app)/catalog')} onclick={() => (open = false)}>
				{m.add_device_open_catalog()}
			</Button>
		{:else}
			<Button variant="primary" type="submit" form={formId} disabled={!chosen}>
				{m.common_continue()}
			</Button>
		{/if}
	{/snippet}
</Dialog>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.note {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
