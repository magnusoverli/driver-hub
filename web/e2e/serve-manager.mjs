// Starts the real Driver Hub manager on a throwaway data directory for the end-to-end tests,
// serving the production build from web/build. Credentials come from e2e/environment.mjs.
//
//   node e2e/serve-manager.mjs            a fresh site with nothing configured
//   node e2e/serve-manager.mjs --cluster  a site connected to the fake Nomad in e2e/cluster,
//                                         with retained releases and seeded deployments
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeNomad, fakeNomadServer } from './cluster/fake-nomad.mjs';
import { retainReleases, seedCluster } from './cluster/seed.mjs';
import {
	ADMIN,
	CLUSTER_PORT,
	FAKE_NOMAD_PORT,
	FAKE_NOMAD_URL,
	PORT,
	SERVICE_TOKEN
} from './environment.mjs';

const cluster = process.argv.includes('--cluster');
const port = cluster ? CLUSTER_PORT : PORT;
const web = fileURLToPath(new URL('..', import.meta.url));
const data = mkdtempSync(join(tmpdir(), 'driverhub-e2e-'));
const passwordFile = join(data, 'bootstrap-password');
writeFileSync(passwordFile, `${ADMIN.password}\n`, { mode: 0o600 });

const fake = new FakeNomad();
/** @type {import('node:http').Server | undefined} */
let nomad;
if (cluster) {
	nomad = fakeNomadServer(fake);
	nomad.listen(FAKE_NOMAD_PORT, '127.0.0.1');
	await once(nomad, 'listening');
	await retainReleases(data);
}

// Start from the caller's environment without any site or credential settings it may carry.
const inherited = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !/^(NOMAD_|DRIVER_HUB_)/.test(key))
);
const manager = spawn(process.execPath, [join(web, '..', 'src', 'main.js')], {
	stdio: 'inherit',
	env: {
		...inherited,
		HOST: '127.0.0.1',
		PORT: String(port),
		DRIVER_HUB_DATA_DIR: data,
		DRIVER_HUB_WEB_DIR: join(web, 'build'),
		DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE: passwordFile,
		DRIVER_HUB_BOOTSTRAP_USERNAME: ADMIN.username,
		DRIVER_HUB_ADMIN_TOKEN: SERVICE_TOKEN
	}
});

const cleanUp = () => rmSync(data, { recursive: true, force: true });
manager.on('exit', (code) => {
	nomad?.close();
	cleanUp();
	process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => manager.kill());

if (cluster) {
	const managerUrl = `http://127.0.0.1:${port}`;
	await waitUntilListening(managerUrl);
	await seedCluster({ managerUrl, nomadUrl: FAKE_NOMAD_URL, token: SERVICE_TOKEN });
	fake.ready = true;
	console.log(`Seeded deployments: http://localhost:${port}/deployments`);
	console.log(`Sign in as ${ADMIN.username} with the password ${ADMIN.password}`);
}

/** @param {string} url */
async function waitUntilListening(url) {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			await fetch(new URL('/api/v1/capabilities', url));
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(`The manager did not start at ${url}`);
}
