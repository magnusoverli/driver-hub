<script lang="ts">
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/ui/Button.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import Spinner from '#lib/ui/Spinner.svelte';

	let { unavailable, onRetry }: { unavailable: boolean; onRetry: () => void } = $props();
</script>

<div class="startup">
	<Logo size={40} />
	{#if unavailable}
		<div class="message" role="alert">
			<h1>{m.startup_unavailable_title()}</h1>
			<p>{m.startup_unavailable_body()}</p>
		</div>
		<Button icon={RefreshCw} onclick={onRetry}>{m.common_retry()}</Button>
	{:else}
		<span class="loading"><Spinner label={m.startup_loading()} /></span>
	{/if}
</div>

<style>
	.startup {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-5);
		min-height: 100vh;
		padding: var(--space-6);
		text-align: center;
	}

	.message {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 26rem;
	}

	h1 {
		font-size: var(--text-xl);
	}

	p {
		color: var(--text-2);
	}

	.loading {
		color: var(--text-3);
		/* Avoid a flash of the spinner when the session check is quick. */
		animation: appear 0s linear 300ms backwards;
	}

	@keyframes appear {
		from {
			visibility: hidden;
		}
	}
</style>
