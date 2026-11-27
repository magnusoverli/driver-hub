<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Dialog } from 'bits-ui';
	import { createQuery } from '@tanstack/svelte-query';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { getApi } from '#lib/api/context.js';
	import { retainedQuery } from '#lib/catalog/queries.js';
	import { deploymentsQuery } from '#lib/deployments/queries.js';
	import { deviceName } from '#lib/deployments/view.js';
	import { operationsQuery } from '#lib/operations/operations.js';
	import { m } from '#lib/paraglide/messages.js';
	import ChangePasswordDialog from '#lib/session/ChangePasswordDialog.svelte';
	import type { Operator } from '#lib/session/auth-service.js';
	import { getSession } from '#lib/session/session.svelte.js';
	import { capabilitiesQuery, nomadConnectionQuery } from '#lib/system/queries.js';
	import CommandPalette from './CommandPalette.svelte';
	import { visibleNavigation } from './navigation';
	import SideNav from './SideNav.svelte';
	import TopBar from './TopBar.svelte';

	let { operator, children }: { operator: Operator; children: Snippet } = $props();

	/** Work in progress is checked this often when nothing runs, so the count stays current. */
	const ACTIVITY_POLL_MS = 30_000;

	const session = getSession();
	const api = getApi();
	const nomad = createQuery(() => nomadConnectionQuery(api));
	const capabilities = createQuery(() => capabilitiesQuery(api));
	const navigation = $derived(visibleNavigation(operator.role));
	const shortcut = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent ?? '') ? '⌘ K' : 'Ctrl K';

	let paletteOpen = $state(false);
	let passwordOpen = $state(false);
	let menuOpen = $state(false);

	// Running downloads and builds, shown beside Activity wherever the operator is.
	const operations = createQuery(() => ({
		...operationsQuery(api, ACTIVITY_POLL_MS),
		enabled: capabilities.data?.asyncAcquisition === true
	}));
	const running = $derived(
		(operations.data ?? []).filter((operation) => operation.state === 'running').length
	);

	// Devices and releases to jump to, loaded only while the palette is open.
	const deployments = createQuery(() => ({
		...deploymentsQuery(api),
		enabled: paletteOpen && capabilities.data?.nomadConfigured === true
	}));
	const retained = createQuery(() => ({ ...retainedQuery(api), enabled: paletteOpen }));
	const devices = $derived(
		(deployments.data ?? []).map((deployment) => ({
			nodeId: deployment.nodeId,
			name: deviceName(deployment),
			detail: `${deployment.driverId} ${deployment.version}`
		}))
	);
	const releases = $derived(
		(retained.data ?? []).map((release) => ({
			driverId: release.driverId,
			version: release.version,
			name: release.displayName
		}))
	);

	afterNavigate(() => (menuOpen = false));

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
		onMenu={() => (menuOpen = true)}
		onChangePassword={changePassword}
		onSignOut={signOut}
	/>
	<div class="body">
		<div class="side">
			<SideNav items={navigation} routeId={page.route.id} counts={{ activity: running }} />
		</div>
		<main id="main" tabindex="-1">
			{@render children()}
		</main>
	</div>
</div>

<!-- The same navigation, as a sheet, on screens too narrow to show it beside the page. -->
<Dialog.Root bind:open={menuOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="nav-sheet">
			<Dialog.Title class="visually-hidden">{m.shell_menu_title()}</Dialog.Title>
			<SideNav items={navigation} routeId={page.route.id} counts={{ activity: running }} />
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<CommandPalette
	bind:open={paletteOpen}
	{navigation}
	{devices}
	{releases}
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
		gap: var(--space-5);
		padding: var(--space-1) var(--space-5) var(--space-8);
	}

	.side {
		flex: none;
		width: var(--nav-width);
	}

	main {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
		max-width: 90rem;
	}

	main:focus {
		outline: none;
	}

	@media (max-width: 56rem) {
		.body {
			padding: var(--space-1) var(--space-3) var(--space-6);
		}

		.side {
			display: none;
		}
	}

	:global(.nav-sheet) {
		position: fixed;
		inset: 0 auto 0 0;
		z-index: 51;
		width: min(18rem, 85vw);
		padding: var(--space-4) var(--space-3);
		overflow-y: auto;
		background: var(--surface-raised);
		box-shadow: var(--elevated);
		animation: sheet-in var(--duration) var(--ease);
	}

	:global(.nav-sheet:focus-visible) {
		outline: none;
	}

	@keyframes -global-sheet-in {
		from {
			transform: translateX(-100%);
		}
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
