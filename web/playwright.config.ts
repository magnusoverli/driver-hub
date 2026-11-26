import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, CLUSTER_BASE_URL, FAKE_NOMAD_URL } from './e2e/environment.mjs';

const browser = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	// One manager and one set of accounts are shared, and sign-in is rate limited per address.
	workers: 1,
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		// A fresh site with nothing configured.
		{ name: 'chromium', testIgnore: 'cluster/**', use: browser },
		// A site connected to the fake Nomad in e2e/cluster, with seeded deployments.
		{
			name: 'cluster',
			testMatch: 'cluster/**/*.e2e.ts',
			use: { ...browser, baseURL: CLUSTER_BASE_URL }
		}
	],
	// Playwright starts these in order, so the second manager starts once the build exists.
	webServer: [
		{
			command: 'npm run build && node e2e/serve-manager.mjs',
			url: BASE_URL,
			reuseExistingServer: false,
			timeout: 180_000,
			stdout: 'pipe'
		},
		{
			command: 'node e2e/serve-manager.mjs --cluster',
			// Ready once the deployments are seeded, not merely when the manager listens.
			url: `${FAKE_NOMAD_URL}/_fake/ready`,
			reuseExistingServer: false,
			timeout: 60_000,
			stdout: 'pipe'
		}
	]
});
