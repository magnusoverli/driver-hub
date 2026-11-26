<script lang="ts">
	import { Command, Dialog } from 'bits-ui';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Layers from '@lucide/svelte/icons/layers';
	import Package from '@lucide/svelte/icons/package';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Search from '@lucide/svelte/icons/search';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';
	import { getTheme, THEME_MODES } from '#lib/theme/theme.svelte.js';
	import type { NavItem } from './navigation';
	import { THEME_ICONS, themeLabel } from './theme-labels';

	type Props = {
		open: boolean;
		navigation: NavItem[];
		/** Devices to jump to, loaded while the palette is open. */
		devices?: { nodeId: string; name: string; detail: string }[];
		/** Retained releases to jump to. */
		releases?: { driverId: string; version: string; name: string }[];
		canChangePassword: boolean;
		onChangePassword: () => void;
		onSignOut: () => void;
	};

	let {
		open = $bindable(false),
		navigation,
		devices = [],
		releases = [],
		canChangePassword,
		onChangePassword,
		onSignOut
	}: Props = $props();

	const theme = getTheme();
	let search = $state('');

	$effect(() => {
		if (!open) search = '';
	});

	function run(action: () => unknown) {
		open = false;
		void action();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="palette" aria-label={m.palette_label()}>
			<Dialog.Title class="visually-hidden">{m.palette_label()}</Dialog.Title>
			<Command.Root class="palette-command" label={m.palette_label()}>
				<div class="palette-search">
					<Search size={16} aria-hidden="true" />
					<Command.Input
						class="palette-input"
						placeholder={m.palette_placeholder()}
						bind:value={search}
					/>
				</div>
				<!-- Focusable so the results can also be scrolled from the keyboard (WCAG 2.1.1). -->
				<Command.List class="palette-list" tabindex={0}>
					<Command.Viewport>
						<Command.Empty class="palette-empty">{m.palette_empty()}</Command.Empty>
						<Command.Group>
							<Command.GroupHeading class="menu-label">
								{m.palette_group_navigate()}
							</Command.GroupHeading>
							<Command.GroupItems>
								{#each navigation as item (item.id)}
									{@const Icon = item.icon}
									<Command.Item
										class="menu-item"
										value={`navigate ${item.id}`}
										keywords={[item.label(), ...(item.keywords ?? [])]}
										onSelect={() => run(() => goto(resolve(item.route)))}
									>
										<Icon size={15} aria-hidden="true" />
										{item.label()}
									</Command.Item>
								{/each}
							</Command.GroupItems>
						</Command.Group>
						{#if devices.length}
							<Command.Group>
								<Command.GroupHeading class="menu-label">
									{m.palette_group_devices()}
								</Command.GroupHeading>
								<Command.GroupItems>
									{#each devices as device (device.nodeId)}
										<Command.Item
											class="menu-item"
											value={`device ${device.nodeId}`}
											keywords={[device.name, device.nodeId, device.detail]}
											onSelect={() =>
												run(() =>
													goto(resolve('/(app)/deployments/[nodeId]', { nodeId: device.nodeId }))
												)}
										>
											<Layers size={15} aria-hidden="true" />
											<span class="item-text">{device.name}</span>
											<span class="item-detail">{device.detail}</span>
										</Command.Item>
									{/each}
								</Command.GroupItems>
							</Command.Group>
						{/if}
						{#if releases.length}
							<Command.Group>
								<Command.GroupHeading class="menu-label">
									{m.palette_group_releases()}
								</Command.GroupHeading>
								<Command.GroupItems>
									{#each releases as release (`${release.driverId}/${release.version}`)}
										<Command.Item
											class="menu-item"
											value={`release ${release.driverId} ${release.version}`}
											keywords={[release.name, release.driverId, release.version]}
											onSelect={() =>
												run(() =>
													goto(
														resolve('/(app)/catalog/[driverId]/[version]', {
															driverId: release.driverId,
															version: release.version
														})
													)
												)}
										>
											<Package size={15} aria-hidden="true" />
											<span class="item-text">{release.name}</span>
											<span class="item-detail">{release.driverId} {release.version}</span>
										</Command.Item>
									{/each}
								</Command.GroupItems>
							</Command.Group>
						{/if}
						<Command.Group>
							<Command.GroupHeading class="menu-label">
								{m.palette_group_theme()}
							</Command.GroupHeading>
							<Command.GroupItems>
								{#each THEME_MODES as mode (mode)}
									{@const Icon = THEME_ICONS[mode]}
									<Command.Item
										class="menu-item"
										value={`theme ${mode}`}
										keywords={[themeLabel(mode), m.theme_heading()]}
										onSelect={() => run(() => theme.set(mode))}
									>
										<Icon size={15} aria-hidden="true" />
										{m.palette_theme_item({ mode: themeLabel(mode) })}
									</Command.Item>
								{/each}
							</Command.GroupItems>
						</Command.Group>
						<Command.Group>
							<Command.GroupHeading class="menu-label">
								{m.palette_group_account()}
							</Command.GroupHeading>
							<Command.GroupItems>
								{#if canChangePassword}
									<Command.Item
										class="menu-item"
										value="account password"
										keywords={[m.account_change_password()]}
										onSelect={() => run(onChangePassword)}
									>
										<KeyRound size={15} aria-hidden="true" />
										{m.account_change_password()}
									</Command.Item>
								{/if}
								<Command.Item
									class="menu-item"
									value="account sign out"
									keywords={[m.account_sign_out()]}
									onSelect={() => run(onSignOut)}
								>
									<LogOut size={15} aria-hidden="true" />
									{m.account_sign_out()}
								</Command.Item>
							</Command.GroupItems>
						</Command.Group>
					</Command.Viewport>
				</Command.List>
			</Command.Root>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	:global(.palette) {
		position: fixed;
		top: 14vh;
		left: 50%;
		z-index: 51;
		width: min(36rem, calc(100vw - 2 * var(--space-4)));
		transform: translateX(-50%);
		border-radius: var(--radius-lg);
		background: var(--surface-raised);
		box-shadow: var(--elevated);
		overflow: hidden;
	}

	:global(.palette:focus-visible) {
		outline: none;
	}

	.palette-search {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 0 var(--space-4);
		border-bottom: 1px solid var(--border);
		color: var(--text-3);
	}

	:global(.palette-input) {
		flex: 1;
		height: 3rem;
		border: 0;
		background: transparent;
		font-size: var(--text-lg);
		color: var(--text);
	}

	:global(.palette-input:focus) {
		outline: none;
	}

	:global(.palette-input::placeholder) {
		color: var(--text-3);
	}

	:global(.palette-list) {
		max-height: min(24rem, 60vh);
		padding: var(--space-1);
		overflow-y: auto;
	}

	.item-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-detail {
		margin-left: auto;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		white-space: nowrap;
	}

	:global(.palette-empty) {
		padding: var(--space-6);
		text-align: center;
		color: var(--text-3);
	}
</style>
