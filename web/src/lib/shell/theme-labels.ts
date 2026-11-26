import type { LucideIcon } from '@lucide/svelte';
import Monitor from '@lucide/svelte/icons/monitor';
import Moon from '@lucide/svelte/icons/moon';
import Sun from '@lucide/svelte/icons/sun';
import { m } from '#lib/paraglide/messages.js';
import type { ThemeMode } from '#lib/theme/theme.svelte.js';

export const THEME_ICONS: Record<ThemeMode, LucideIcon> = {
	system: Monitor,
	light: Sun,
	dark: Moon
};

const labels: Record<ThemeMode, () => string> = {
	system: m.theme_system,
	light: m.theme_light,
	dark: m.theme_dark
};

export function themeLabel(mode: ThemeMode): string {
	return labels[mode]();
}
