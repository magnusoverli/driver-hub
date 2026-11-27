<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { m } from '#lib/paraglide/messages.js';
	import ChangePasswordDialog from '#lib/session/ChangePasswordDialog.svelte';
	import ReauthDialog from '#lib/session/ReauthDialog.svelte';
	import { getSession } from '#lib/session/session.svelte.js';
	import AppShell from '#lib/shell/AppShell.svelte';
	import { navItemFor } from '#lib/shell/navigation.js';
	import Card from '#lib/ui/Card.svelte';
	import Callout from '#lib/ui/Callout.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const session = getSession();
	const queryClient = useQueryClient();
	let passwordChanged = $state(false);
	afterNavigate(() => (passwordChanged = false));
	const forbidden = $derived(Boolean(navItemFor(page.route.id)?.adminOnly) && !session.isAdmin);
</script>

{#if session.operator?.mustChangePassword}
	<ChangePasswordDialog open required onChanged={() => (passwordChanged = true)} />
{:else if session.operator}
	<AppShell operator={session.operator}>
		{#if passwordChanged}
			<Callout tone="ok" live>{m.password_first_login_success()}</Callout>
		{/if}
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
