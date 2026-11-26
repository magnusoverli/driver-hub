<script lang="ts">
	import type { Snippet } from 'svelte';
	import { createQuery } from '@tanstack/svelte-query';
	import { page } from '$app/state';
	import { getApi } from '#lib/api/context.js';
	import { m } from '#lib/paraglide/messages.js';
	import ChangePasswordDialog from '#lib/session/ChangePasswordDialog.svelte';
	import type { Operator } from '#lib/session/auth-service.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { nomadConnectionQuery } from '#lib/system/queries.js';
	import CommandPalette from './CommandPalette.svelte';
	import { visibleNavigation } from './navigation';
	import SideNav from './SideNav.svelte';
	import TopBar from './TopBar.svelte';

	let { operator, children }: { operator: Operator; children: Snippet } = $props();

	const session = getSession();
	const api = getApi();
	const nomad = createQuery(() => nomadConnectionQuery(api));
	const navigation = $derived(visibleNavigation(operator.role));
	const shortcut = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent ?? '') ? '⌘ K' : 'Ctrl K';

	let paletteOpen = $state(false);
	let passwordOpen = $state(false);

	function onKeydown(event: KeyboardEvent) {
		if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey) {
			event.preventDefault();
			paletteOpen = !paletteOpen;
		}
	}

	const signOut = () => void session.signOut();
	const changePassword = () => (passwordOpen = true);
</script>

<svelte:window onkeydown={onKeydown} />

<a class="skip-link" href="#main">{m.shell_skip_to_content()}</a>

<div class="shell">
	<TopBar
		{operator}
		namespace={nomad.data?.state === 'connected' ? nomad.data.namespace : undefined}
		{shortcut}
		canChangePassword={session.managesOwnPassword}
		onSearch={() => (paletteOpen = true)}
		onChangePassword={changePassword}
		onSignOut={signOut}
	/>
	<div class="body">
		<SideNav items={navigation} routeId={page.route.id} />
		<main id="main" tabindex="-1">
			{@render children()}
		</main>
	</div>
</div>

<CommandPalette
	bind:open={paletteOpen}
	{navigation}
	canChangePassword={session.managesOwnPassword}
	onChangePassword={changePassword}
	onSignOut={signOut}
/>
<ChangePasswordDialog bind:open={passwordOpen} />

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	.body {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
		padding: var(--space-1) var(--space-5) var(--space-8);
	}

	.body > :global(.side-nav) {
		flex: 1 1 var(--nav-width);
		max-width: var(--nav-width);
	}

	main {
		display: flex;
		flex: 999 1 35rem;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
		max-width: 90rem;
	}

	main:focus {
		outline: none;
	}

	.skip-link {
		position: absolute;
		top: var(--space-2);
		left: var(--space-2);
		z-index: 60;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius);
		background: var(--surface-raised);
		box-shadow: var(--elevated);
		transform: translateY(-200%);
	}

	.skip-link:focus {
		transform: none;
	}
</style>
