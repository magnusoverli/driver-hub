import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from '../environment.mjs';
import { signIn } from '../support';
import { DEVICES, stubUpdates } from './fixture';

async function audit(page: Page) {
	// Measure dialogs at full opacity, after their opening animation.
	await page.evaluate(() =>
		Promise.all(document.getAnimations().map((animation) => animation.finished))
	);
	const { violations } = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

for (const colorScheme of ['light', 'dark'] as const) {
	test.describe(`${colorScheme} theme`, () => {
		test.use({ colorScheme });

		test('catalog, staging, activity and site pages meet WCAG 2.2 AA', async ({ page }) => {
			await stubUpdates(page);
			await page.route('**/api/v1/releases?*', (route) =>
				route.fulfill({
					json: { releases: [{ driverId: 'exampleco-meter', version: '1.5.0', prerelease: false }] }
				})
			);
			await signIn(page, ADMIN, '/catalog');
			await expect(page.getByRole('table', { name: 'Published releases' })).toBeVisible();
			expect(await audit(page)).toEqual([]);

			await page.getByRole('tab', { name: 'Retained releases' }).click();
			await page
				.getByRole('row')
				.filter({ hasText: '1.4.0' })
				.getByRole('button', { name: 'Stage new device' })
				.click();
			const stage = page.getByRole('dialog');
			await stage.getByRole('button', { name: 'Preview', exact: true }).click();
			await expect(stage.getByText('Required.').first()).toBeVisible();
			expect(await audit(page)).toEqual([]);
			await page.keyboard.press('Escape');

			for (const [path, heading] of [
				['/', 'Overview'],
				['/catalog/exampleco-meter/1.4.0', 'ExampleCo Meter'],
				['/activity', 'Activity'],
				['/site/users', 'Users'],
				['/site/nomad', 'Nomad cluster'],
				['/site/videoipath', 'VideoIPath']
			]) {
				await page.goto(path);
				await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
				await expect(page.getByRole('status').filter({ hasText: /Loading/ })).toHaveCount(0);
				expect(await audit(page), path).toEqual([]);
			}

			await page.goto('/site/users');
			await page.getByRole('button', { name: 'Add account' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			expect(await audit(page)).toEqual([]);

			await page.goto(`/deployments/${DEVICES.spare.nodeId}`);
			await page.getByRole('button', { name: 'More actions' }).click();
			await page.getByRole('menuitem', { name: 'Delete deployment…' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			expect(await audit(page)).toEqual([]);
			await page.keyboard.press('Escape');

			await page.setViewportSize({ width: 420, height: 860 });
			await page.getByRole('button', { name: 'Open navigation' }).click();
			await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
			expect(await audit(page)).toEqual([]);
		});
	});
}
