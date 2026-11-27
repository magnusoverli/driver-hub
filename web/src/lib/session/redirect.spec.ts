import { describe, expect, it } from 'vitest';
import { safeNextPath, signInPath } from './redirect.js';

describe('safeNextPath', () => {
	it.each([
		['/deployments', '/deployments'],
		['/settings/users?filter=admin#top', '/settings/users?filter=admin#top'],
		['/a/../deployments', '/deployments']
	])('keeps the same-origin path %s', (next, expected) => {
		expect(safeNextPath(next)).toBe(expected);
	});

	it.each([
		null,
		'',
		'deployments',
		'//evil.example/phish',
		'/\\evil.example',
		'https://evil.example/',
		'javascript:alert(1)',
		'/login?next=/deployments'
	])('falls back to the overview for %s', (next) => {
		expect(safeNextPath(next)).toBe('/');
	});
});

describe('signInPath', () => {
	it('remembers where the operator was going', () => {
		expect(signInPath({ pathname: '/settings/users', search: '?q=1' })).toBe(
			'/login?next=%2Fsettings%2Fusers%3Fq%3D1'
		);
	});

	it('omits a return path for the overview and the sign-in page itself', () => {
		expect(signInPath({ pathname: '/', search: '' })).toBe('/login');
		expect(signInPath({ pathname: '/login', search: '?next=%2Fx' })).toBe('/login');
	});
});
