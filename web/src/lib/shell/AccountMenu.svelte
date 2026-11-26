<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { m } from '#lib/paraglide/messages.js';
	import type { Operator } from '#lib/session/auth-service.js';
	import { roleLabel } from './role-labels';

	type Props = {
		operator: Operator;
		canChangePassword: boolean;
		onChangePassword: () => void;
		onSignOut: () => void;
	};

	let { operator, canChangePassword, onChangePassword, onSignOut }: Props = $props();
	const initials = $derived(
		operator.username
			.replace(/[^a-z0-9]/gi, '')
			.slice(0, 2)
			.toUpperCase()
	);
</script>

<DropdownMenu.Root>
	<!--
		The accessible name ("Account: admin, Administrator") is built around the visible username,
		so speech input users can say what they see (WCAG 2.5.3). The initials are drawn by CSS
		and are not part of the text.
	-->
	<DropdownMenu.Trigger class="account-trigger">
		<span class="avatar" data-initials={initials} aria-hidden="true"></span>
		<span class="visually-hidden">{m.account_menu_prefix()}</span>
		<span class="name">{operator.username}</span>
		<span class="visually-hidden">{m.account_menu_role({ role: roleLabel(operator.role) })}</span>
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content class="menu-content" align="end" sideOffset={6}>
			<div class="identity">
				<span class="identity-name">{operator.username}</span>
				<span class="identity-role">
					{m.account_role_provider({ role: roleLabel(operator.role), provider: operator.provider })}
				</span>
			</div>
			<DropdownMenu.Separator class="menu-separator" />
			{#if canChangePassword}
				<DropdownMenu.Item class="menu-item" onSelect={onChangePassword}>
					<KeyRound size={15} aria-hidden="true" />
					{m.account_change_password()}
				</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Item class="menu-item" onSelect={onSignOut}>
				<LogOut size={15} aria-hidden="true" />
				{m.account_sign_out()}
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
	:global(.account-trigger) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: var(--control);
		padding: 0 var(--space-3) 0 var(--space-1);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--text);
		cursor: pointer;
	}

	:global(.account-trigger:hover),
	:global(.account-trigger[data-state='open']) {
		background: var(--hover);
	}

	:global(.account-trigger:focus-visible) {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: var(--radius);
		background: var(--accent-soft);
		color: var(--accent-text);
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
	}

	.avatar::before {
		content: attr(data-initials);
	}

	.name {
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
	}

	.identity {
		display: flex;
		flex-direction: column;
		padding: var(--space-2) var(--space-3);
	}

	.identity-name {
		font-weight: var(--weight-semibold);
	}

	.identity-role {
		font-size: var(--text-sm);
		color: var(--text-3);
	}
</style>
