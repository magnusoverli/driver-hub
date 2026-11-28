<script lang="ts">
	import Menu from '@lucide/svelte/icons/menu';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Search from '@lucide/svelte/icons/search';
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';
	import type { Operator } from '#lib/session/auth-service.js';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Kbd from '#lib/ui/Kbd.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import AccountMenu from './AccountMenu.svelte';
	import ThemeMenu from './ThemeMenu.svelte';

	type Props = {
		operator: Operator;
		/** The Nomad namespace Hub manages, once known. */
		namespace?: string;
		/** Site setup items that need attention; shown in place of the namespace while any do. */
		siteIssues?: number;
		/** Whether the operator can open Settings to fix them. */
		canOpenSettings?: boolean;
		shortcut: string;
		canChangePassword: boolean;
		onSearch: () => void;
		/** Opens the navigation on screens too narrow to show it beside the page. */
		onMenu: () => void;
		onChangePassword: () => void;
		onSignOut: () => void;
	};

	let {
		operator,
		namespace,
		siteIssues = 0,
		canOpenSettings = false,
		shortcut,
		canChangePassword,
		onSearch,
		onMenu,
		onChangePassword,
		onSignOut
	}: Props = $props();
</script>

<header class="top-bar">
	<div class="brand">
		<IconButton class="menu-button" icon={Menu} label={m.shell_open_menu()} onclick={onMenu} />
		<a class="home" href={resolve('/(app)')} aria-label={m.topbar_home()}>
			<Logo />
			<span class="product">Driver Hub</span>
		</a>
		<!-- Site health travels with every page; device pages only show what affects a device. -->
		{#if siteIssues > 0}
			{#if canOpenSettings}
				<a class="scope issues" href={resolve('/(app)/settings')}>
					<TriangleAlert size={13} aria-hidden="true" />
					{m.topbar_site_issues({ count: siteIssues })}
				</a>
			{:else}
				<span class="scope issues" title={m.topbar_site_issues_viewer()}>
					<TriangleAlert size={13} aria-hidden="true" />
					{m.topbar_site_issues({ count: siteIssues })}
				</span>
			{/if}
		{:else if namespace}
			<span class="scope mono" title={m.topbar_namespace_title()}>
				{m.topbar_namespace({ namespace })}
			</span>
		{/if}
	</div>

	<button type="button" class="search" onclick={onSearch} aria-keyshortcuts="Control+K Meta+K">
		<Search size={15} aria-hidden="true" />
		<span class="search-label">{m.topbar_search()}</span>
		<span class="shortcut"><Kbd>{shortcut}</Kbd></span>
	</button>

	<div class="end">
		<ThemeMenu />
		<AccountMenu {operator} {canChangePassword} {onChangePassword} {onSignOut} />
	</div>
</header>

<style>
	.top-bar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 28rem) minmax(0, 1fr);
		align-items: center;
		gap: var(--space-4);
		height: 3.75rem;
		padding: 0 var(--space-5);
	}

	.brand,
	.end {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}

	.end {
		justify-content: flex-end;
		gap: var(--space-1);
	}

	.home {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		border-radius: var(--radius);
		color: var(--text);
		text-decoration: none;
	}

	.product {
		font-size: var(--text-lg);
		font-weight: var(--weight-bold);
		letter-spacing: -0.01em;
		white-space: nowrap;
	}

	.scope {
		overflow: hidden;
		padding: 0.15rem var(--space-2);
		border-radius: var(--radius-pill);
		background: var(--surface);
		box-shadow: var(--ring);
		color: var(--text-2);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.issues {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: var(--warn-soft);
		box-shadow: none;
		color: var(--warn);
		font-weight: var(--weight-semibold);
		text-decoration: none;
	}

	a.issues:hover {
		text-decoration: underline;
	}

	a.issues:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.search {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: var(--control);
		padding: 0 var(--space-2) 0 var(--space-4);
		border: 0;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: var(--ring);
		color: var(--text-3);
		font-size: var(--text-md);
		text-align: left;
		cursor: pointer;
	}

	.search:hover {
		color: var(--text-2);
	}

	.search:focus-visible {
		outline: none;
		box-shadow: var(--ring), var(--focus-ring);
	}

	.search-label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.menu-button) {
		display: none !important;
	}

	/* Narrow screens: the navigation moves into a menu and the search becomes a button. */
	@media (max-width: 56rem) {
		.top-bar {
			grid-template-columns: minmax(0, 1fr) auto auto;
			gap: var(--space-2);
			padding: 0 var(--space-3);
		}

		:global(.menu-button) {
			display: inline-flex !important;
		}

		.scope,
		.shortcut {
			display: none;
		}

		.search {
			padding: 0 var(--space-3);
		}
	}

	@media (max-width: 36rem) {
		/* Still the button's name, which must contain any visible label (WCAG 2.5.3). */
		.search-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}

		.product {
			font-size: var(--text-md);
		}
	}
</style>
