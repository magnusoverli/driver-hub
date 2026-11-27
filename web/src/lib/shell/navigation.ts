import type { LucideIcon } from '@lucide/svelte';
import Activity from '@lucide/svelte/icons/activity';
import KeyRound from '@lucide/svelte/icons/key-round';
import Layers from '@lucide/svelte/icons/layers';
import LayoutGrid from '@lucide/svelte/icons/layout-grid';
import Link2 from '@lucide/svelte/icons/link-2';
import Package from '@lucide/svelte/icons/package';
import Server from '@lucide/svelte/icons/server';
import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import Users from '@lucide/svelte/icons/users';
import type { RouteId } from '$app/types';
import { m } from '#lib/paraglide/messages.js';
import type { Role } from '#lib/session/auth-service.js';

export type NavSection = 'main' | 'settings';

/** Routes that can be linked without parameters, such as every top-level section. */
export type StaticRouteId = Exclude<RouteId, `${string}[${string}`>;

export interface NavItem {
	id: string;
	/** A SvelteKit route ID, so links are checked against the routes that exist. */
	route: StaticRouteId;
	label: () => string;
	icon: LucideIcon;
	section: NavSection;
	/** Routes whose API requires the admin role are hidden from viewers. */
	adminOnly?: boolean;
	/** Extra words the command palette matches on. */
	keywords?: string[];
}

const HOME: StaticRouteId = '/(app)';

export const NAVIGATION: readonly NavItem[] = [
	{
		id: 'overview',
		route: HOME,
		label: m.nav_overview,
		icon: LayoutGrid,
		section: 'main',
		keywords: ['home', 'readiness']
	},
	{
		id: 'deployments',
		route: '/(app)/deployments',
		label: m.nav_deployments,
		icon: Layers,
		section: 'main',
		keywords: ['devices', 'drivers']
	},
	{
		id: 'catalog',
		route: '/(app)/catalog',
		label: m.nav_catalog,
		icon: Package,
		section: 'main',
		keywords: ['releases', 'builds', 'updates']
	},
	{
		id: 'activity',
		route: '/(app)/activity',
		label: m.nav_activity,
		icon: Activity,
		section: 'main',
		keywords: ['operations', 'downloads']
	},
	{
		id: 'nomad',
		route: '/(app)/settings/nomad',
		label: m.nav_nomad,
		icon: Server,
		section: 'settings',
		adminOnly: true,
		keywords: ['cluster', 'scheduler', 'image host', 'settings']
	},
	{
		id: 'videoipath',
		route: '/(app)/settings/videoipath',
		label: m.nav_videoipath,
		icon: Link2,
		section: 'settings',
		adminOnly: true,
		keywords: ['tokens', 'target', 'settings']
	},
	{
		id: 'users',
		route: '/(app)/settings/users',
		label: m.nav_users,
		icon: Users,
		section: 'settings',
		adminOnly: true,
		keywords: ['accounts', 'operators', 'settings']
	},
	{
		id: 'api-tokens',
		route: '/(app)/settings/api-tokens',
		label: m.nav_api_tokens,
		icon: KeyRound,
		section: 'settings',
		adminOnly: true,
		keywords: ['scripts', 'automation', 'bearer', 'settings']
	},
	{
		id: 'manager',
		route: '/(app)/settings/manager',
		label: m.nav_manager,
		icon: SlidersHorizontal,
		section: 'settings',
		adminOnly: true,
		keywords: ['builds', 'environment', 'compose', 'startup', 'settings']
	}
];

export function visibleNavigation(
	role: Role | undefined,
	items: readonly NavItem[] = NAVIGATION
): NavItem[] {
	return items.filter((item) => !item.adminOnly || role === 'admin');
}

/** The overview matches only itself; every other item also matches its sub-routes. */
export function isActive(item: Pick<NavItem, 'route'>, routeId: string | null): boolean {
	if (!routeId) return false;
	if (item.route === HOME) return routeId === HOME;
	return routeId === item.route || routeId.startsWith(`${item.route}/`);
}

/** The navigation item a route belongs to, used for admin-only route guards. */
export function navItemFor(
	routeId: string | null,
	items: readonly NavItem[] = NAVIGATION
): NavItem | undefined {
	return items.find((item) => item.route !== HOME && isActive(item, routeId));
}
