<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { m } from '#lib/paraglide/messages.js';
	import IconButton from './IconButton.svelte';

	type Props = {
		value: string;
		/** What is copied, for example "Copy node ID". */
		label: string;
	};

	let { value, label }: Props = $props();
	// The Clipboard API exists only in secure contexts, which is how the app is served anyway.
	const available = typeof navigator !== 'undefined' && Boolean(navigator.clipboard);
	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			return;
		}
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1500);
	}

	$effect(() => () => clearTimeout(timer));
</script>

{#if available}
	<IconButton size="sm" icon={copied ? Check : Copy} {label} onclick={copy} />
	<span class="visually-hidden" role="status">{copied ? m.copy_done() : ''}</span>
{/if}
