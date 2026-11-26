<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	type Tone = 'info' | 'ok' | 'warn' | 'fail';
	type Props = {
		tone?: Tone;
		title?: string;
		/** Errors interrupt assistive technology; other tones are announced politely. */
		live?: boolean;
		children?: Snippet;
	};

	let { tone = 'info', title, live = false, children }: Props = $props();
	const icons = { info: Info, ok: CircleCheck, warn: TriangleAlert, fail: CircleAlert };
	const Icon = $derived(icons[tone]);
	const role = $derived(live ? (tone === 'fail' ? 'alert' : 'status') : undefined);
</script>

<div class="callout" data-tone={tone} {role}>
	<Icon size={16} aria-hidden="true" />
	<div class="content">
		{#if title}<p class="title">{title}</p>{/if}
		{#if children}<div class="body">{@render children()}</div>{/if}
	</div>
</div>

<style>
	.callout {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
	}

	.callout :global(svg) {
		flex: none;
		margin-top: 0.15rem;
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.title {
		font-weight: var(--weight-semibold);
	}

	.body {
		color: var(--text-2);
	}

	[data-tone='info'] {
		background: var(--sunken);
		color: var(--text);
	}

	[data-tone='ok'] {
		background: var(--ok-soft);
		color: var(--ok);
	}

	[data-tone='warn'] {
		background: var(--warn-soft);
		color: var(--warn);
	}

	[data-tone='fail'] {
		background: var(--fail-soft);
		color: var(--fail);
	}
</style>
