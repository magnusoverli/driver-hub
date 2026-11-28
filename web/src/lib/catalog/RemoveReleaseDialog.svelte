<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { resolve } from '$app/paths';
	import { getApi } from '#lib/api/context.js';
	import { errorMessage } from '#lib/api/messages.js';
	import { deploymentsQuery } from '#lib/deployments/queries.js';
	import { deviceName, shortId } from '#lib/deployments/view.js';
	import { m } from '#lib/paraglide/messages.js';
	import Callout from '#lib/ui/Callout.svelte';
	import ConfirmDialog from '#lib/ui/ConfirmDialog.svelte';
	import { releaseUses, removeRelease, type Identity, type ReleaseUse } from './queries';

	type Props = {
		open: boolean;
		release: Identity & { displayName?: string; origin?: string };
		onRemoved: () => void;
	};

	let { open = $bindable(false), release, onRemoved }: Props = $props();

	const api = getApi();
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let uses = $state<ReleaseUse[]>([]);
	// Names for the devices a refusal lists, when the cluster can report them.
	const deployments = createQuery(() => ({ ...deploymentsQuery(api), enabled: uses.length > 0 }));
	const devices = $derived(new Map((deployments.data ?? []).map((d) => [d.nodeId, d])));

	$effect(() => {
		if (open) {
			problem = null;
			uses = [];
		}
	});

	// A customer build cannot be downloaded again, so removing it asks for its version.
	const customer = $derived(release.origin === 'customer');

	async function confirm() {
		busy = true;
		problem = null;
		uses = [];
		try {
			await removeRelease(api, release);
			open = false;
			onRemoved();
		} catch (error) {
			uses = releaseUses(error);
			problem = uses.length ? null : errorMessage(error);
		} finally {
			busy = false;
		}
	}
</script>

<ConfirmDialog
	bind:open
	title={m.release_remove_title({
		name: release.displayName ?? release.driverId,
		version: release.version
	})}
	confirmLabel={m.release_remove_confirm()}
	phrase={customer ? release.version : undefined}
	{busy}
	{problem}
	onConfirm={confirm}
>
	<p>{m.release_remove_body()}</p>
	<p class="note">
		{customer ? m.release_remove_customer_note() : m.release_remove_maintainer_note()}
	</p>
	{#if uses.length}
		<Callout tone="warn" title={m.release_remove_in_use()} live>
			<ul>
				{#each uses as use (`${use.nodeId}-${use.use}`)}
					{@const device = devices.get(use.nodeId)}
					<li>
						<a href={resolve('/(app)/devices/[nodeId]', { nodeId: use.nodeId })}>
							{device ? deviceName(device) : shortId(use.nodeId)}
						</a>
						{use.use === 'unconfirmed'
							? m.release_use_unconfirmed()
							: use.use === 'current'
								? m.release_use_current()
								: m.release_use_previous()}
					</li>
				{/each}
			</ul>
		</Callout>
	{/if}
</ConfirmDialog>

<style>
	.note {
		color: var(--text-2);
		font-size: var(--text-sm);
	}
</style>
