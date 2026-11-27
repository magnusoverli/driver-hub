import { describe, expect, it } from 'vitest';
import { isActive, NAVIGATION, navItemFor, visibleNavigation } from './navigation.js';

describe('navigation', () => {
	it('hides site administration from viewers', () => {
		expect(visibleNavigation('viewer').map((item) => item.id)).toEqual([
			'overview',
			'deployments',
			'catalog',
			'activity'
		]);
		expect(visibleNavigation('admin')).toHaveLength(NAVIGATION.length);
		expect(visibleNavigation(undefined).some((item) => item.adminOnly)).toBe(false);
	});

	it('marks the overview active only on itself, other items also on their sub-routes', () => {
		const overview = { route: '/(app)' } as const;
		const deployments = { route: '/(app)/deployments' } as const;
		expect(isActive(overview, '/(app)')).toBe(true);
		expect(isActive(overview, '/(app)/deployments')).toBe(false);
		expect(isActive(deployments, '/(app)/deployments')).toBe(true);
		expect(isActive(deployments, '/(app)/deployments/[nodeId]')).toBe(true);
		expect(isActive(deployments, '/(app)/deployments-archive')).toBe(false);
		expect(isActive(deployments, null)).toBe(false);
	});

	it('finds the item that guards a route', () => {
		expect(navItemFor('/(app)/settings/users')?.adminOnly).toBe(true);
		expect(navItemFor('/(app)/deployments')?.adminOnly).toBeUndefined();
		expect(navItemFor('/(app)')).toBeUndefined();
		expect(navItemFor('/login')).toBeUndefined();
	});

	it('gives every item a distinct id and route', () => {
		expect(new Set(NAVIGATION.map((item) => item.id)).size).toBe(NAVIGATION.length);
		expect(new Set(NAVIGATION.map((item) => item.route)).size).toBe(NAVIGATION.length);
	});
});
