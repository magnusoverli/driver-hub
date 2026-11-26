import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './e2e/environment.mjs';

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
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
		}
	],
	webServer: {
		command: 'npm run build && node e2e/serve-manager.mjs',
		url: BASE_URL,
		reuseExistingServer: false,
		timeout: 180_000,
		stdout: 'pipe'
	}
});
