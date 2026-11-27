<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { page } from '$app/state';
	import { m } from '#lib/paraglide/messages.js';
	import ChangePasswordDialog from '#lib/session/ChangePasswordDialog.svelte';
	import ReauthDialog from '#lib/session/ReauthDialog.svelte';
	import { getSession } from '#lib/session/session.svelte.js';
	import AppShell from '#lib/shell/AppShell.svelte';
	import { navItemFor } from '#lib/shell/navigation.js';
	import Card from '#lib/ui/Card.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const session = getSession();
	const queryClient = useQueryClient();
	const forbidden = $derived(Boolean(navItemFor(page.route.id)?.adminOnly) && !session.isAdmin);
</script>

{#if session.operator?.mustChangePassword}
	<ChangePasswordDialog open required />
{:else if session.operator}
	<AppShell operator={session.operator}>
		{#if forbidden}
			<Card>
				<EmptyState icon={ShieldAlert} title={m.forbidden_title()}>
					<p>{m.forbidden_body()}</p>
				</EmptyState>
			</Card>
		{:else}
			{@render children()}
		{/if}
	</AppShell>
	<ReauthDialog onResumed={() => void queryClient.invalidateQueries()} />
{/if}
