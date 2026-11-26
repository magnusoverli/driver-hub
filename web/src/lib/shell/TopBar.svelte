<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';
	import type { Operator } from '#lib/session/auth-service.js';
	import Kbd from '#lib/ui/Kbd.svelte';
	import Logo from '#lib/ui/Logo.svelte';
	import AccountMenu from './AccountMenu.svelte';
	import ThemeMenu from './ThemeMenu.svelte';

	type Props = {
		operator: Operator;
		/** The Nomad namespace Hub manages, once known. */
		namespace?: string;
		shortcut: string;
		canChangePassword: boolean;
		onSearch: () => void;
		onChangePassword: () => void;
		onSignOut: () => void;
	};

	let {
		operator,
		namespace,
		shortcut,
		canChangePassword,
		onSearch,
		onChangePassword,
		onSignOut
	}: Props = $props();
</script>

<header class="top-bar">
	<div class="brand">
		<a class="home" href={resolve('/(app)')} aria-label={m.topbar_home()}>
			<Logo />
			<span class="product">Driver Hub</span>
		</a>
		{#if namespace}
			<span class="scope mono" title={m.topbar_namespace_title()}>
				{m.topbar_namespace({ namespace })}
			</span>
		{/if}
	</div>

	<button type="button" class="search" onclick={onSearch} aria-keyshortcuts="Control+K Meta+K">
		<Search size={15} aria-hidden="true" />
		<span class="search-label">{m.topbar_search()}</span>
		<Kbd>{shortcut}</Kbd>
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
</style>
