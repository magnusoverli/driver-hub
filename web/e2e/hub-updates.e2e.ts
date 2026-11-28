import { expect, test } from '@playwright/test';
import { ADMIN } from './environment.mjs';
import { signIn } from './support';

test('target notes render in Hub; ignore is reversible from About; start requires confirmation', async ({
	page
}) => {
	const version = 'v0.0.19',
		installed = 'v0.0.18';
	let ignored = '',
		phase = '',
		starts = 0;
	await page.route('**/api/v1/hub-updates**', async (route) => {
		const req = route.request(),
			path = new URL(req.url()).pathname;
		if (req.method() === 'POST' && /\/(start|ignore)$/.test(path)) {
			expect(req.postDataJSON()).toEqual({ version });
			if (path.endsWith('/ignore')) ignored = version;
			else {
				starts++;
				phase = 'downloading';
			}
			return route.fulfill({ json: { accepted: true } });
		}
		return route.fulfill({
			json: {
				installed,
				managed: true,
				ignored,
				checked: 1,
				checkError: false,
				operation: phase ? { phase, version } : null,
				candidate: {
					version,
					readiness: 'ready',
					notes: '## Changes\n\n- Keep **existing mounts**.\n- Render `<script>` as text.'
				}
			}
		});
	});
	await signIn(page, ADMIN, '/');
	await page.getByText('What’s new in v0.0.19').click();
	await expect(page.getByRole('heading', { name: 'Changes' })).toBeVisible();
	await expect(page.getByText('existing mounts', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Ignore this version' }).click();
	await expect(page.getByText('Driver Hub v0.0.19 is available')).toBeHidden();
	await page.goto('/about');
	await page.getByRole('button', { name: 'Update', exact: true }).click();
	expect(starts).toBe(0);
	await page.getByRole('dialog').getByRole('button', { name: 'Update', exact: true }).click();
	await expect(page.getByText('Downloading update · v0.0.19')).toBeVisible();
	expect(starts).toBe(1);
});
