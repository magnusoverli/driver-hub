import { describe, expect, it } from 'vitest';
import {
	isActive,
	NAVIGATION,
	navItemFor,
	paletteNavigation,
	settingsNavigation,
	sidebarNavigation,
	visibleNavigation
} from './navigation.js';

describe('navigation', () => {
	it('shows devices and the catalog to everyone, and settings to administrators', () => {
		expect(sidebarNavigation(visibleNavigation('viewer')).map((item) => item.id)).toEqual([
			'devices',
			'catalog'
		]);
		expect(sidebarNavigation(visibleNavigation('admin')).map((item) => item.id)).toEqual([
			'devices',
			'catalog',
			'settings'
		]);
		expect(visibleNavigation(undefined).some((item) => item.adminOnly)).toBe(false);
	});

	it('groups the settings pages', () => {
		expect(
			settingsNavigation(NAVIGATION).map((group) => [group.id, group.items.map((i) => i.id)])
		).toEqual([
			['setup', ['setup']],
			['connections', ['nomad', 'videoipath']],
			['access', ['users', 'api-tokens']],
			['advanced', ['advanced']]
		]);
	});

	it('offers every page in the palette once, including Activity', () => {
		const ids = paletteNavigation(visibleNavigation('admin')).map((item) => item.id);
		expect(ids).toContain('activity');
		expect(ids).toContain('users');
		expect(ids).not.toContain('settings');
	});

	it('marks home and exact items active only on themselves, others also on sub-routes', () => {
		const home = { route: '/(app)' } as const;
		const catalog = { route: '/(app)/catalog' } as const;
		const setup = { route: '/(app)/settings', exact: true } as const;
		expect(isActive(home, '/(app)')).toBe(true);
		expect(isActive(home, '/(app)/catalog')).toBe(false);
		expect(isActive(catalog, '/(app)/catalog')).toBe(true);
		expect(isActive(catalog, '/(app)/catalog/[driverId]')).toBe(true);
		expect(isActive(catalog, '/(app)/catalog-archive')).toBe(false);
		expect(isActive(catalog, null)).toBe(false);
		expect(isActive(setup, '/(app)/settings')).toBe(true);
		expect(isActive(setup, '/(app)/settings/users')).toBe(false);
	});

	it('finds the item that guards a route', () => {
		expect(navItemFor('/(app)/settings/users')?.adminOnly).toBe(true);
		expect(navItemFor('/(app)/settings')?.adminOnly).toBe(true);
		expect(navItemFor('/(app)/catalog')?.adminOnly).toBeUndefined();
		expect(navItemFor('/(app)/devices/[nodeId]')).toBeUndefined();
		expect(navItemFor('/(app)')).toBeUndefined();
		expect(navItemFor('/login')).toBeUndefined();
	});

	it('gives every item a distinct id', () => {
		expect(new Set(NAVIGATION.map((item) => item.id)).size).toBe(NAVIGATION.length);
	});
});
