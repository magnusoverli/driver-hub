// Takes the README screenshots from the seeded demo (`npm run demo`, http://localhost:4182).
//
//   node scripts/screenshots.mjs [output directory, default ../docs/screenshots]
//
// The demo runs the real manager against a stand-in Nomad cluster. What the demo cannot show
// realistically is answered in the browser with illustrative data: upstream releases and
// updates (GitHub), image distribution (no packaged image service), background downloads and
// the VideoIPath endpoint check. A VideoIPath target with a token pool is saved through the API.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { ADMIN, CLUSTER_BASE_URL as BASE, SERVICE_TOKEN } from '../e2e/environment.mjs';

const out = resolve(
	process.argv[2] ?? fileURLToPath(new URL('../../docs/screenshots', import.meta.url))
);
mkdirSync(out, { recursive: true });
const service = { Authorization: `Bearer ${SERVICE_TOKEN}`, 'Content-Type': 'application/json' };

/**
 * Calls the manager's API with the demo's service token.
 * @template T
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<T>}
 */
async function api(path, init = {}) {
	const response = await fetch(`${BASE}/api/v1${path}`, { ...init, headers: service });
	if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
	/** @type {unknown} */
	const body = await response.json();
	return /** @type {T} */ (body);
}

/** @typedef {{ nodeId: string, label: string | null }} Device */

const { deployments: devices } = /** @type {{ deployments: Device[] }} */ (
	await api('/deployments')
);
/** @param {string} name */
const byName = (name) => {
	const device = devices.find((entry) => entry.label === name);
	if (!device) throw new Error(`The demo has no device named ${name}`);
	return device;
};

// A site VideoIPath target with a small token pool, as an administrator would save it.
const site = /** @type {{ revision: number, videoipath: { url: string | null } }} */ (
	await api('/site')
);
if (!site.videoipath.url) {
	await api('/site/videoipath', {
		method: 'PUT',
		body: JSON.stringify({
			revision: site.revision,
			address: 'vip.site.example',
			tokenMode: 'per-device',
			tokens: ['demo-token-a'.padEnd(40, 'a'), 'demo-token-b'.padEnd(40, 'b')]
		})
	});
}

/** @param {number} minutes */
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const stubs = {
	'/releases': {
		releases: [
			{
				driverId: 'acme-gateway',
				version: '2.1.0',
				prerelease: false,
				displayName: 'Acme Gateway'
			},
			{
				driverId: 'acme-gateway',
				version: '2.0.1',
				prerelease: false,
				displayName: 'Acme Gateway'
			},
			{
				driverId: 'exampleco-meter',
				version: '1.5.0',
				prerelease: false,
				displayName: 'ExampleCo Meter'
			},
			{
				driverId: 'exampleco-meter',
				version: '1.4.0',
				prerelease: false,
				displayName: 'ExampleCo Meter'
			},
			{
				driverId: 'exampleco-meter',
				version: '1.3.0',
				prerelease: false,
				displayName: 'ExampleCo Meter'
			},
			{
				driverId: 'studiolink-tally',
				version: '0.9.2',
				prerelease: false,
				displayName: 'StudioLink Tally'
			}
		]
	},
	'/updates': {
		updates: [
			{
				nodeId: byName('Control room meter').nodeId,
				driverId: 'exampleco-meter',
				version: '1.4.0',
				availableVersion: '1.5.0'
			}
		]
	},
	'/integrations/images': {
		state: 'ready',
		source: 'http://hub.site.example:5481',
		images: 4,
		running: 3,
		upToDate: 3,
		problems: []
	},
	'/operations': {
		operations: [
			{
				id: '7b0c0b52-2f3e-4f7e-9a51-0c1d2e3f4a5b',
				kind: 'retain',
				target: { driverId: 'exampleco-meter', version: '1.5.0' },
				startedAt: minutesAgo(0.7),
				state: 'running'
			},
			{
				id: '3c6a1f0e-8d2b-4c47-b0a9-5e6f7a8b9c0d',
				kind: 'build',
				target: { driverId: 'rust-example', commit: 'f64a319caf5f3b1d2e4c6a8b0d2f4e6a8c0b2d4f' },
				startedAt: minutesAgo(64),
				finishedAt: minutesAgo(62),
				state: 'failed',
				failure: { status: 422, code: 'build_failed', error: 'Buildx failed to build this driver' }
			},
			{
				id: '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b',
				kind: 'retain',
				target: { driverId: 'exampleco-meter', version: '1.4.0' },
				startedAt: minutesAgo(10),
				finishedAt: minutesAgo(9.8),
				state: 'succeeded',
				release: {
					driverId: 'exampleco-meter',
					version: '1.4.0',
					digest: `sha256:${'a'.repeat(64)}`
				}
			}
		]
	},
	'/site/videoipath/check': {
		endpoint: 'wss://vip.site.example/x-driver/v1',
		state: 'auth_required',
		httpStatus: 401
	}
};

const browser = await chromium.launch();

/**
 * A signed-in page with the illustrative data in place.
 * @param {{ width?: number, height?: number, colorScheme?: 'light' | 'dark' }} [options]
 */
async function session({ width = 1280, height = 860, colorScheme = 'light' } = {}) {
	const context = await browser.newContext({ viewport: { width, height }, colorScheme });
	const page = await context.newPage();
	for (const [path, json] of Object.entries(stubs)) {
		await page.route(new RegExp(`/api/v1${path.replace(/\//g, '\\/')}(\\?.*)?$`), (route) =>
			route.fulfill({ json })
		);
	}
	await page.goto(`${BASE}/login`);
	await page.getByLabel('Username').fill(ADMIN.username);
	await page.getByLabel('Password').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL((url) => url.pathname !== '/login');
	return page;
}

/** Waits for loading indicators and polling to settle, then takes the screenshot. */
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {{ fullPage?: boolean, target?: import('@playwright/test').Locator }} [options]
 */
async function shot(page, name, { fullPage = false, target } = {}) {
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(600);
	await (target ?? page).screenshot({ path: `${out}/${name}.png`, fullPage });
	console.log(`${name}.png`);
}

const page = await session();
/** @param {string} path */
const open = async (path) => {
	await page.goto(`${BASE}${path}`);
	await page.waitForLoadState('networkidle');
};

await open('/');
await shot(page, 'devices');

await open(`/devices/${byName('Studio 3 meter').nodeId}`);
await shot(page, 'device');
await page.getByRole('button', { name: /Update to/ }).click();
await page.getByRole('button', { name: 'Preview update' }).click();
await page.getByRole('dialog').getByText('Nomad can place the driver now').waitFor();
await shot(page, 'update-preview');
await page.keyboard.press('Escape');

await open(`/devices/${byName('Rack B gateway').nodeId}`);
await page.getByText(/^Diagnostics/).click();
await page.getByRole('tab', { name: /Scheduler evaluations/ }).click();
await page
	.getByText(/clients evaluated/)
	.first()
	.waitFor();
await page.getByText(/^Diagnostics/).scrollIntoViewIfNeeded();
await shot(page, 'diagnostics');

await open('/catalog');
await shot(page, 'catalog');
await open('/catalog/exampleco-meter');
await shot(page, 'driver');
await open('/catalog/exampleco-meter/1.4.0');
await shot(page, 'release');

await open('/devices/new?driver=exampleco-meter&version=1.4.0');
await page.getByLabel('Device name').fill('Studio 5 meter');
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByLabel(/^Device host/).waitFor();
await page.getByLabel(/^Device host/).fill('meter-studio5.site.example');
await page.getByLabel(/^Device credential/).fill('device_token');
await shot(page, 'setup');

await open('/activity');
await shot(page, 'activity');
await open('/settings');
await shot(page, 'site-setup');
await open('/settings/videoipath');
await page.getByText('Driver endpoint reachable').waitFor();
await shot(page, 'videoipath');

const dark = await session({ colorScheme: 'dark' });
await dark.goto(`${BASE}/devices/${byName('Control room meter').nodeId}`);
await shot(dark, 'device-dark');

const narrow = await session({ width: 390, height: 844 });
await narrow.goto(`${BASE}/`);
await shot(narrow, 'mobile');

await browser.close();
