<script lang="ts">
	import { getApi } from '#lib/api/context.js';
	import { m } from '#lib/paraglide/messages.js';
	import Callout from '#lib/ui/Callout.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import { deleteDeployment, deletionProblem, type Deletion } from './lifecycle';
	import type { Deployment } from './queries';
	import { deviceName, shortId } from './view';

	type Props = {
		open: boolean;
		deployment: Deployment;
		onDeleted: (deletion: Deletion) => void;
	};

	let { open = $bindable(false), deployment, onDeleted }: Props = $props();

	const api = getApi();
	let busy = $state(false);
	let problem = $state<string | null>(null);

	$effect(() => {
		if (open) problem = null;
	});

	const stopped = $derived(deployment.requested === 'stopped');
	const jobId = $derived(`driverhub-${deployment.nodeId}`);

	async function confirm() {
		busy = true;
		problem = null;
		try {
			const deletion = await deleteDeployment(api, deployment.nodeId, deployment.revision);
			open = false;
			onDeleted(deletion);
		} catch (error) {
			problem = deletionProblem(error);
		} finally {
			busy = false;
		}
	}
</script>

<ConfirmDialog
	bind:open
	title={m.delete_title({ name: deviceName(deployment) })}
	confirmLabel={m.delete_confirm()}
	phrase={deployment.label ?? shortId(deployment.nodeId)}
	blocked={!stopped}
	{busy}
	{problem}
	onConfirm={confirm}
>
	{#if !stopped}
		<Callout tone="warn" title={m.delete_stop_first_title()}>{m.delete_stop_first_body()}</Callout>
	{:else}
		<p>{m.delete_removes({ job: jobId })}</p>
		<p class="kept-title">{m.delete_keeps_title()}</p>
		<ul class="kept">
			<li>{m.delete_keeps_secrets({ variable: `nomad/jobs/${jobId}` })}</li>
			{#if deployment.inheritsSite}<li>{m.delete_keeps_token()}</li>{/if}
			<li>{m.delete_keeps_videoipath()}</li>
		</ul>
	{/if}
</ConfirmDialog>

<style>
	.kept-title {
		font-weight: var(--weight-semibold);
	}

	.kept {
		color: var(--text-2);
	}
</style>
