// Starts the real Driver Hub manager on a throwaway data directory for the end-to-end tests,
// serving the production build from web/build. Credentials come from e2e/environment.mjs.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN, PORT, SERVICE_TOKEN } from './environment.mjs';

const web = fileURLToPath(new URL('..', import.meta.url));
const data = mkdtempSync(join(tmpdir(), 'driverhub-e2e-'));
const passwordFile = join(data, 'bootstrap-password');
writeFileSync(passwordFile, `${ADMIN.password}\n`, { mode: 0o600 });

// Start from the caller's environment without any site or credential settings it may carry.
const inherited = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !/^(NOMAD_|DRIVER_HUB_)/.test(key))
);
const manager = spawn(process.execPath, [join(web, '..', 'src', 'main.js')], {
	stdio: 'inherit',
	env: {
		...inherited,
		HOST: '127.0.0.1',
		PORT: String(PORT),
		DRIVER_HUB_DATA_DIR: data,
		DRIVER_HUB_WEB_DIR: join(web, 'build'),
		DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE: passwordFile,
		DRIVER_HUB_BOOTSTRAP_USERNAME: ADMIN.username,
		DRIVER_HUB_ADMIN_TOKEN: SERVICE_TOKEN
	}
});

const cleanUp = () => rmSync(data, { recursive: true, force: true });
manager.on('exit', (code) => {
	cleanUp();
	process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => manager.kill());
