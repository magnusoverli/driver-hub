import type { LucideIcon } from '@lucide/svelte';
import Activity from '@lucide/svelte/icons/activity';
import Info from '@lucide/svelte/icons/info';
import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
import KeyRound from '@lucide/svelte/icons/key-round';
import Layers from '@lucide/svelte/icons/layers';
import Link2 from '@lucide/svelte/icons/link-2';
import Package from '@lucide/svelte/icons/package';
import Server from '@lucide/svelte/icons/server';
import Settings from '@lucide/svelte/icons/settings';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import Users from '@lucide/svelte/icons/users';
import type { RouteId } from '$app/types';
import { m } from '#lib/paraglide/messages.js';
import type { Role } from '#lib/session/auth-service.js';

/**
 * Where an item is listed. The side navigation shows "main" items at the top and "site" items
 * below them; "settings" pages are listed inside Settings; "other" pages only in the command
 * palette and in links from related pages.
 */
export type NavSection = 'main' | 'site' | 'settings' | 'other';

/** How the settings pages are grouped inside Settings. */
export type SettingsGroup = 'setup' | 'connections' | 'access' | 'advanced';

/** Routes that can be linked without parameters, such as every top-level section. */
export type StaticRouteId = Exclude<RouteId, `${string}[${string}`>;

export interface NavItem {
	id: string;
	/** A SvelteKit route ID, so links are checked against the routes that exist. */
	route: StaticRouteId;
	label: () => string;
	icon: LucideIcon;
	section: NavSection;
	/** Settings pages only: the group it is listed under. */
	group?: SettingsGroup;
	/** Routes whose API requires the admin role are hidden from viewers. */
	adminOnly?: boolean;
	/** Matches only its own route, not the routes below it. */
	exact?: boolean;
	/** Extra words the command palette matches on. */
	keywords?: string[];
}

const HOME: StaticRouteId = '/(app)';

export const NAVIGATION: readonly NavItem[] = [
	{
		id: 'devices',
		route: HOME,
		label: m.nav_devices,
		icon: Layers,
		section: 'main',
		keywords: ['home', 'overview', 'deployments', 'status', 'updates']
	},
	{
		id: 'catalog',
		route: '/(app)/catalog',
		label: m.nav_catalog,
		icon: Package,
		section: 'main',
		keywords: ['drivers', 'releases', 'download', 'builds', 'import']
	},
	{
		id: 'activity',
		route: '/(app)/activity',
		label: m.nav_activity,
		icon: Activity,
		section: 'other',
		keywords: ['operations', 'downloads', 'builds', 'history']
	},
	{
		id: 'settings',
		route: '/(app)/settings',
		label: m.nav_settings,
		icon: Settings,
		section: 'site',
		adminOnly: true,
		keywords: ['readiness', 'setup', 'site']
	},
	{
		id: 'about',
		route: '/(app)/about',
		label: m.nav_about,
		icon: Info,
		section: 'site',
		keywords: ['release', 'version', 'build', 'documentation']
	},
	{
		id: 'setup',
		route: '/(app)/settings',
		label: m.nav_site_setup,
		icon: ClipboardCheck,
		section: 'settings',
		group: 'setup',
		adminOnly: true,
		exact: true,
		keywords: ['readiness', 'settings']
	},
	{
		id: 'nomad',
		route: '/(app)/settings/nomad',
		label: m.nav_nomad,
		icon: Server,
		section: 'settings',
		group: 'connections',
		adminOnly: true,
		keywords: ['cluster', 'scheduler', 'image distribution', 'settings']
	},
	{
		id: 'videoipath',
		route: '/(app)/settings/videoipath',
		label: m.nav_videoipath,
		icon: Link2,
		section: 'settings',
		group: 'connections',
		adminOnly: true,
		keywords: ['tokens', 'target', 'settings']
	},
	{
		id: 'users',
		route: '/(app)/settings/users',
		label: m.nav_users,
		icon: Users,
		section: 'settings',
		group: 'access',
		adminOnly: true,
		keywords: ['accounts', 'operators', 'settings']
	},
	{
		id: 'api-tokens',
		route: '/(app)/settings/api-tokens',
		label: m.nav_api_tokens,
		icon: KeyRound,
		section: 'settings',
		group: 'access',
		adminOnly: true,
		keywords: ['scripts', 'automation', 'bearer', 'settings']
	},
	{
		id: 'advanced',
		route: '/(app)/settings/advanced',
		label: m.nav_advanced,
		icon: SlidersHorizontal,
		section: 'settings',
		group: 'advanced',
		adminOnly: true,
		keywords: ['manager', 'source builds', 'timings', 'environment', 'jobs', 'settings']
	}
];

export const SETTINGS_GROUPS: readonly { id: SettingsGroup; label: () => string }[] = [
	{ id: 'setup', label: m.settings_group_setup },
	{ id: 'connections', label: m.settings_group_connections },
	{ id: 'access', label: m.settings_group_access },
	{ id: 'advanced', label: m.settings_group_advanced }
];

/** Items for the side navigation: the main sections, then site administration. */
export function sidebarNavigation(items: readonly NavItem[]): NavItem[] {
	return items.filter((item) => item.section === 'main' || item.section === 'site');
}

/** Settings pages by group, in the order they are listed inside Settings. */
export function settingsNavigation(items: readonly NavItem[]) {
	return SETTINGS_GROUPS.map((group) => ({
		...group,
		items: items.filter((item) => item.section === 'settings' && item.group === group.id)
	})).filter((group) => group.items.length > 0);
}

/** Every page the command palette offers, without the Settings entry its first page repeats. */
export function paletteNavigation(items: readonly NavItem[]): NavItem[] {
	return items.filter((item) => item.section !== 'site');
}

export function visibleNavigation(
	role: Role | undefined,
	items: readonly NavItem[] = NAVIGATION
): NavItem[] {
	return items.filter((item) => !item.adminOnly || role === 'admin');
}

/** The home page and exact items match only themselves; others also match their sub-routes. */
export function isActive(item: Pick<NavItem, 'route' | 'exact'>, routeId: string | null): boolean {
	if (!routeId) return false;
	if (item.route === HOME || item.exact) return routeId === item.route;
	return routeId === item.route || routeId.startsWith(`${item.route}/`);
}

/** The navigation item a route belongs to, used for admin-only route guards. */
export function navItemFor(
	routeId: string | null,
	items: readonly NavItem[] = NAVIGATION
): NavItem | undefined {
	return items.find((item) => item.route !== HOME && isActive(item, routeId));
}
