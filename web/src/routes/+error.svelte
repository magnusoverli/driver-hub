<script lang="ts">
	import Compass from '@lucide/svelte/icons/compass';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/ui/Button.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
</script>

<svelte:head>
	<title>{m.error_page_title()} · Driver Hub</title>
</svelte:head>

<main class="error-page">
	<EmptyState
		icon={Compass}
		title={page.status === 404 ? m.error_not_found_title() : m.error_page_title()}
	>
		<p>{page.status === 404 ? m.error_not_found_body() : page.error?.message}</p>
		{#snippet actions()}
			<Button variant="primary" href={resolve('/(app)')}>{m.error_go_overview()}</Button>
		{/snippet}
	</EmptyState>
</main>

<style>
	.error-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
	}
</style>
