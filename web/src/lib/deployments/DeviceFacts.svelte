<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import CopyButton from '#lib/ui/CopyButton.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import type { Deployment } from './queries';
	import { imageDigest, shortDigest } from './view';

	let { deployment }: { deployment: Deployment } = $props();

	const digest = $derived(imageDigest(deployment.image));
	const jobId = $derived(`driverhub-${deployment.nodeId}`);
</script>

<!-- How Nomad runs this device: for troubleshooting, so it lives under Diagnostics. -->
<Facts>
	<dt>{m.facts_image()}</dt>
	<dd>
		<span class="with-copy">
			<code title={deployment.image}>{shortDigest(digest)}</code>
			<CopyButton value={deployment.image} label={m.facts_copy_image()} />
		</span>
	</dd>
	<dt>{m.facts_image_copy()}</dt>
	<dd>
		{#if deployment.backupImageClient}
			{m.facts_image_copy_on({ client: deployment.backupImageClient })}
		{:else}
			<span class="secondary">{m.facts_image_copy_none()}</span>
		{/if}
	</dd>
	<dt>{m.facts_job()}</dt>
	<dd><code>{jobId}</code></dd>
	<dt>{m.facts_revision()}</dt>
	<dd><span class="mono">{deployment.revision}</span></dd>
</Facts>

<style>
	/* Long identifiers wrap beside their copy button instead of pushing it to its own line. */
	.with-copy {
		display: flex;
		flex: 1;
		align-items: flex-start;
		gap: var(--space-2);
		min-width: 0;
	}

	code {
		min-width: 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.with-copy :global(.icon-button) {
		flex: none;
		margin-top: -0.3rem;
	}

	.secondary {
		color: var(--text-3);
		font-size: var(--text-sm);
	}
</style>
