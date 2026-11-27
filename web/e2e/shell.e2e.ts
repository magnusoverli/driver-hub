import { expect, test } from '@playwright/test';
import { ADMIN } from './environment.mjs';
import { signIn } from './support';

test('the theme choice applies at once and is restored before the app starts', async ({ page }) => {
	await signIn(page, ADMIN);
	const root = page.locator('html');
	await page.getByRole('button', { name: 'Theme: Match system' }).click();
	await page.getByRole('menuitemradio', { name: 'Dark' }).click();
	await expect(root).toHaveAttribute('data-theme', 'dark');

	await page.reload({ waitUntil: 'domcontentloaded' });
	expect(await root.getAttribute('data-theme')).toBe('dark');
	await expect(page.getByRole('button', { name: 'Theme: Dark' })).toBeVisible();

	await page.getByRole('button', { name: 'Theme: Dark' }).click();
	await page.getByRole('menuitemradio', { name: 'Match system' }).click();
	await expect(root).not.toHaveAttribute('data-theme');
});

test('the command palette opens from the keyboard and navigates', async ({ page }) => {
	await signIn(page, ADMIN);
	await page.keyboard.press('Control+k');
	const search = page.getByPlaceholder('Type a page or an action');
	await expect(search).toBeFocused();
	await search.fill('releases');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL('/catalog');
	await expect(page.getByRole('dialog')).toBeHidden();

	await page.getByRole('button', { name: /Search or jump to/ }).click();
	await page.getByPlaceholder('Type a page or an action').fill('dark');
	await page.keyboard.press('Enter');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('every section deep-links, and unknown addresses get a not-found page', async ({ page }) => {
	await signIn(page, ADMIN);
	const sections: [string, string][] = [
		['/', 'Overview'],
		['/deployments', 'Deployments'],
		['/catalog', 'Catalog'],
		['/activity', 'Activity'],
		['/settings/nomad', 'Nomad cluster'],
		['/settings/videoipath', 'VideoIPath'],
		['/settings/users', 'Users'],
		['/settings/api-tokens', 'API tokens'],
		['/settings/manager', 'Manager']
	];
	for (const [path, heading] of sections) {
		await page.goto(path);
		await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
		await expect(page).toHaveTitle(`${heading} · Driver Hub`);
	}
	await page.goto('/no/such/page');
	await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('the overview reports what the site still needs', async ({ page }) => {
	await signIn(page, ADMIN);
	const readiness = page.getByRole('region', { name: 'Site readiness' });
	await expect(readiness.getByText('No cluster address is configured yet.')).toBeVisible();
	await expect(
		readiness.getByText('Starts once the Nomad connection and Hub download address are set.')
	).toBeVisible();
	await expect(page.getByText('Setup needs attention (3)')).toBeVisible();
	await readiness.getByRole('link', { name: 'Open settings' }).first().click();
	await expect(page).toHaveURL('/settings/nomad');
});

test('on a narrow screen the navigation opens from a menu and closes after choosing', async ({
	page
}) => {
	await signIn(page, ADMIN);
	await page.setViewportSize({ width: 420, height: 860 });
	await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
	await page.getByRole('button', { name: 'Open navigation' }).click();
	const menu = page.getByRole('dialog', { name: 'Navigation' });
	await menu.getByRole('link', { name: 'Catalog' }).click();
	await expect(page).toHaveURL('/catalog');
	await expect(menu).toBeHidden();
	const width = await page.evaluate(() => document.documentElement.scrollWidth);
	expect(width).toBeLessThanOrEqual(420);
});

test('running downloads and builds are counted beside Activity on every page', async ({ page }) => {
	await page.route('**/api/v1/operations', (route) =>
		route.fulfill({
			json: {
				operations: [
					{
						id: crypto.randomUUID(),
						kind: 'retain',
						state: 'running',
						target: { driverId: 'exampleco-meter', version: '1.5.0' },
						startedAt: new Date().toISOString()
					}
				]
			}
		})
	);
	await signIn(page, ADMIN, '/settings/users');
	await expect(page.getByRole('link', { name: 'Activity 1 running' })).toBeVisible();
});
