<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import Check from '@lucide/svelte/icons/check';
	import { m } from '#lib/paraglide/messages.js';
	import { getTheme, THEME_MODES, type ThemeMode } from '#lib/theme/theme.svelte.js';
	import IconButton from '#lib/ui/IconButton.svelte';
	import { THEME_ICONS, themeLabel } from './theme-labels';

	const theme = getTheme();
	const CurrentIcon = $derived(THEME_ICONS[theme.mode]);
	const label = $derived(m.theme_menu_label({ mode: themeLabel(theme.mode) }));
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<IconButton {...props} {label} icon={CurrentIcon} />
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content class="menu-content" align="end" sideOffset={6}>
			<DropdownMenu.RadioGroup
				value={theme.mode}
				onValueChange={(mode) => theme.set(mode as ThemeMode)}
				aria-label={m.theme_heading()}
			>
				<DropdownMenu.GroupHeading class="menu-label">
					{m.theme_heading()}
				</DropdownMenu.GroupHeading>
				{#each THEME_MODES as mode (mode)}
					{@const Icon = THEME_ICONS[mode]}
					<DropdownMenu.RadioItem value={mode} class="menu-item">
						{#snippet children({ checked })}
							<Icon size={15} aria-hidden="true" />
							{themeLabel(mode)}
							{#if checked}<Check class="menu-trailing" size={15} aria-hidden="true" />{/if}
						{/snippet}
					</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
