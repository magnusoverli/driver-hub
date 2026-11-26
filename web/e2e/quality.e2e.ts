import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN } from './environment.mjs';
import { signIn } from './support';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function accessibilityViolations(page: Page) {
	const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
	return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

for (const colorScheme of ['light', 'dark'] as const) {
	test.describe(`${colorScheme} theme`, () => {
		test.use({ colorScheme });

		test('sign-in and overview meet WCAG 2.2 AA', async ({ page }) => {
			await page.goto('/login');
			await expect(page.getByLabel('Username')).toBeVisible();
			expect(await accessibilityViolations(page)).toEqual([]);

			await page.getByLabel('Username').fill(ADMIN.username);
			await page.getByLabel('Password').fill('wrong password');
			await page.getByRole('button', { name: 'Sign in' }).click();
			await expect(page.getByRole('alert')).toBeVisible();
			expect(await accessibilityViolations(page)).toEqual([]);

			await page.getByLabel('Password').fill(ADMIN.password);
			await page.getByRole('button', { name: 'Sign in' }).click();
			await expect(page.getByText('Site readiness')).toBeVisible();
			await expect(page.getByText('Checking…')).toHaveCount(0);
			expect(await accessibilityViolations(page)).toEqual([]);

			await page.keyboard.press('Control+k');
			await expect(page.getByRole('dialog')).toBeVisible();
			expect(await accessibilityViolations(page)).toEqual([]);
		});
	});
}

test('the app runs under its Content-Security-Policy without violations', async ({ page }) => {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
	});
	const response = await page.goto('/login');
	const policy = response?.headers()['content-security-policy'] ?? '';
	expect(policy).toMatch(/script-src 'self' 'sha256-/);
	expect(policy).toContain("frame-ancestors 'none'");
	await signIn(page, ADMIN);
	await page.getByRole('link', { name: 'Deployments' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Deployments' })).toBeVisible();
	// Both self-hosted families load under font-src 'self' (none may be inlined as data: URIs).
	const loadedFamilies = await page.evaluate(async () => {
		await document.fonts.ready;
		return [...document.fonts]
			.filter((face) => face.status === 'loaded')
			.map((face) => face.family.replace(/"/g, ''));
	});
	expect(new Set(loadedFamilies)).toEqual(new Set(['Hanken Grotesk Variable', 'DM Mono']));
	expect(violations).toEqual([]);
});

test('keyboard users can skip to the content', async ({ page }) => {
	await signIn(page, ADMIN);
	await page.keyboard.press('Tab');
	const skip = page.getByRole('link', { name: 'Skip to content' });
	await expect(skip).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('main#main')).toBeFocused();
});
