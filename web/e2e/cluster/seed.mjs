// Seeds a Driver Hub installation that talks to the fake Nomad with a realistic set of devices.
// Releases are written with the manager's own release store (tiny but valid OCI images), and
// every deployment is staged, started, updated and stopped through the management API, so jobs,
// versions and evaluations are exactly what the backend produces.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

/** @param {string | Buffer} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {unknown} value */
const encode = (value) => Buffer.from(JSON.stringify(value));

/**
 * The manager's own release writer. It is loaded at run time so that the web project does not
 * type-check the backend's sources.
 * @param {string} root
 */
async function releaseStore(root) {
	const specifier = new URL('../../../src/release-store.js', import.meta.url).href;
	/** @type {{ ReleaseStore: new (root: string) => ReleaseWriter }} */
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the backend is untyped JavaScript
	const module = await import(specifier);
	return new module.ReleaseStore(root);
}

/** @typedef {{ save(release: unknown, chunks: AsyncIterable<Buffer>): Promise<unknown> }} ReleaseWriter */

/** @type {(text: string) => unknown} */
const parseJson = JSON.parse;

/**
 * A POSIX ustar archive of regular files, as an OCI image layout export contains.
 * @param {{ name: string, data: Buffer }[]} files
 */
function tarball(files) {
	/** @type {Buffer[]} */
	const blocks = [];
	for (const { name, data } of files) {
		const header = Buffer.alloc(512);
		const octal = (/** @type {number} */ value, /** @type {number} */ width) =>
			value.toString(8).padStart(width - 1, '0') + '\0';
		header.write(name, 0, 100, 'utf8');
		header.write(octal(0o644, 8), 100);
		header.write(octal(0, 8), 108);
		header.write(octal(0, 8), 116);
		header.write(octal(data.length, 12), 124);
		header.write(octal(0, 12), 136);
		header.write(' '.repeat(8), 148);
		header.write('0', 156);
		header.write('ustar\0', 257);
		header.write('00', 263);
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
		blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
	}
	blocks.push(Buffer.alloc(1024));
	return Buffer.concat(blocks);
}

const meterInputs = [
	{ name: 'deviceHost', type: 'string', required: true, minLength: 1, env: 'DEVICE_HOST' },
	{ name: 'deviceCredential', type: 'string', required: true, secret: true, env: 'DEVICE_TOKEN' },
	{
		name: 'pollSeconds',
		type: 'integer',
		required: false,
		default: 5,
		minimum: 1,
		maximum: 60,
		env: 'POLL_SECONDS'
	}
];
const meter = {
	schemaVersion: 1,
	controlHealth: { port: 8080, path: '/control' },
	inputs: meterInputs
};
const gatewayInputs = [
	{ name: 'deviceHost', type: 'string', required: true, minLength: 1, env: 'DEVICE_HOST' },
	{
		name: 'port',
		type: 'integer',
		required: false,
		default: 9000,
		minimum: 1,
		maximum: 65535,
		env: 'DEVICE_PORT'
	}
];

/** Released versions available to the fixture, as the catalog would have retained them. */
export const RELEASES = [
	{
		driverId: 'exampleco-meter',
		displayName: 'ExampleCo Meter',
		version: '1.3.0',
		configuration: meter
	},
	{
		driverId: 'exampleco-meter',
		displayName: 'ExampleCo Meter',
		version: '1.4.0',
		configuration: meter
	},
	{
		driverId: 'acme-gateway',
		displayName: 'Acme Gateway',
		version: '2.0.1',
		configuration: { schemaVersion: 1, inputs: gatewayInputs }
	},
	{
		// Adds a required setting, so updating with the existing settings is refused.
		driverId: 'acme-gateway',
		displayName: 'Acme Gateway',
		version: '2.1.0',
		configuration: {
			schemaVersion: 1,
			inputs: [...gatewayInputs, { name: 'region', type: 'string', required: true, env: 'REGION' }]
		}
	}
];

/** A gzipped OCI image layout with one tiny layer, and the digest of its manifest. */
export function ociArchive(/** @type {string} */ content) {
	/** @type {{ name: string, data: Buffer }[]} */
	const files = [];
	const type = 'application/vnd.oci.image.';
	const blob = (/** @type {string} */ mediaType, /** @type {Buffer} */ data) => {
		const hex = sha256(data);
		files.push({ name: `blobs/sha256/${hex}`, data });
		return { mediaType, digest: `sha256:${hex}`, size: data.length };
	};
	const config = blob(`${type}config.v1+json`, encode({ os: 'linux', architecture: 'amd64' }));
	const layer = blob(`${type}layer.v1.tar`, Buffer.from(content));
	const manifest = blob(
		`${type}manifest.v1+json`,
		encode({ schemaVersion: 2, config, layers: [layer] })
	);
	files.push({ name: 'index.json', data: encode({ schemaVersion: 2, manifests: [manifest] }) });
	files.push({ name: 'oci-layout', data: encode({ imageLayoutVersion: '1.0.0' }) });
	return { bytes: gzipSync(tarball(files)), digest: manifest.digest };
}

/**
 * Writes every fixture release into the manager's data directory before it starts.
 * @param {string} dataDir
 */
export async function retainReleases(dataDir) {
	const store = await releaseStore(join(dataDir, 'releases'));
	for (const release of RELEASES) {
		const { driverId, version, displayName, configuration } = release;
		const archive = ociArchive(`${driverId} ${version}`);
		const configBytes = encode(configuration);
		const record = {
			schemaVersion: 1,
			driverId,
			version,
			displayName,
			source: { commit: sha256(driverId).slice(0, 40), directory: `Drivers/${displayName}` },
			configuration: { file: 'driver-config.json', sha256: sha256(configBytes) },
			image: {
				archive: `${driverId}.tar.gz`,
				digest: archive.digest,
				platforms: ['linux/amd64'],
				archiveSha256: sha256(archive.bytes)
			}
		};
		await store.save(
			{ detail: { record, configuration }, manifestBytes: encode(record), configBytes },
			Readable.from([archive.bytes])
		);
	}
}

/** The seeded devices, by the role they play in the tests. */
export const DEVICES = {
	/** Running, and its control check reports the driver connected. */
	studio: { nodeId: '6f1c2a54-9d3e-4b7a-8c21-0a5e7d9b3f10', label: 'Studio 3 meter' },
	/** Running, but Nomad has not placed its allocation; no control check is declared. */
	gateway: { nodeId: 'b2d4e6f8-1a3c-4e5f-9a7b-2c4d6e8f0a1b', label: 'Rack B gateway' },
	/** Unnamed and stopped after an update, so it can be rolled back. */
	spare: { nodeId: 'c3e5a7b9-2b4d-4f6a-8b9c-3d5e7f9a1b2c', label: null },
	/** Running, and its control check fails. */
	control: { nodeId: 'd4f6b8c0-3c5e-4a7b-9c0d-4e6f8a0b2c3d', label: 'Control room meter' },
	/** Nomad cannot report it at the moment. */
	truck: { nodeId: 'e5a7c9d1-4d6f-4b8c-8d1e-5f7a9b1c3d4e', label: 'Truck 2 meter' },
	/** Staged to replace an external driver that still has to be stopped. */
	migrated: { nodeId: 'f6b8d0e2-5e7a-4c9d-9e2f-6a8b0c2d4e5f', label: 'Edit suite meter' }
};

const meterSettings = (/** @type {string} */ host) => ({
	deviceHost: host,
	deviceCredential: { secretRef: 'device_token' }
});

/**
 * Resets the fake cluster and stages every device again through the manager.
 * @param {{ managerUrl: string, nomadUrl: string, token: string }} target
 */
export async function seedCluster({ managerUrl, nomadUrl, token }) {
	/**
	 * @param {string} method
	 * @param {string} path
	 * @param {unknown} [body]
	 * @param {Record<string, string>} [headers]
	 * @returns {Promise<{ revision: number }>}
	 */
	async function call(method, path, body, headers = {}) {
		const response = await fetch(new URL(`/api/v1${path}`, managerUrl), {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				...headers
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const text = await response.text();
		if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text}`);
		return /** @type {{ revision: number }} */ (parseJson(text));
	}
	/**
	 * @param {string} nodeId
	 * @param {import('./fake-nomad.mjs').Scenario} value
	 */
	async function scenario(nodeId, value) {
		const response = await fetch(new URL(`/_fake/scenario/driverhub-${nodeId}`, nomadUrl), {
			method: 'PUT',
			body: JSON.stringify(value)
		});
		if (!response.ok) throw new Error(`Setting the fake Nomad scenario failed: ${response.status}`);
	}
	/**
	 * Labels are kept by the manager, so staging with `label: null` also clears a name that a
	 * previous test gave the device.
	 * @param {{ nodeId: string, label: string | null }} device
	 * @param {string} driverId
	 * @param {string} version
	 * @param {Record<string, unknown>} settings
	 */
	async function stage({ nodeId, label }, driverId, version, settings, { migration = false } = {}) {
		// Manual settings, so seeding never depends on, or draws from, a site's VideoIPath tokens.
		const body = { driverId, version, settings, label, inheritSite: false };
		const staged = migration
			? await call('POST', '/deployments', { ...body, nodeId })
			: await call('POST', '/deployments', body, { 'Idempotency-Key': nodeId });
		return staged.revision;
	}
	const act = async (
		/** @type {string} */ nodeId,
		/** @type {string} */ action,
		/** @type {Record<string, unknown>} */ body
	) => (await call('POST', `/deployments/${nodeId}/${action}`, body)).revision;

	const reset = await fetch(new URL('/_fake/reset', nomadUrl), { method: 'POST' });
	if (!reset.ok) throw new Error(`Resetting the fake Nomad failed: ${reset.status}`);

	const { studio, gateway, spare, control, truck, migrated } = DEVICES;

	let revision = await stage(
		studio,
		'exampleco-meter',
		'1.3.0',
		meterSettings('meter-studio3.site.example')
	);
	await act(studio.nodeId, 'start', { revision });

	revision = await stage(gateway, 'acme-gateway', '2.0.1', {
		deviceHost: 'gw-rack-b.site.example',
		port: 9001
	});
	await act(gateway.nodeId, 'start', { revision });
	await scenario(gateway.nodeId, {
		allocation: 'pending',
		evaluations: [
			{
				ID: '9a1d2c3b-0000-4000-8000-00000000b10c',
				Status: 'blocked',
				TriggeredBy: 'queued-allocs',
				JobModifyIndex: 0,
				CreateIndex: 99_999,
				FailedTGAllocs: {
					device: {
						NodesEvaluated: 3,
						NodesFiltered: 2,
						NodesExhausted: 1,
						ConstraintFiltered: { '${attr.cpu.arch} regexp ^(amd64)$': 2 },
						DimensionExhausted: { memory: 1 }
					}
				}
			}
		]
	});

	revision = await stage(
		spare,
		'exampleco-meter',
		'1.3.0',
		meterSettings('meter-spare.site.example')
	);
	revision = await act(spare.nodeId, 'start', { revision });
	revision = await act(spare.nodeId, 'update', { revision, version: '1.4.0' });
	await act(spare.nodeId, 'stop', { revision });

	revision = await stage(control, 'exampleco-meter', '1.4.0', {
		...meterSettings('meter-control.site.example'),
		pollSeconds: 2
	});
	await act(control.nodeId, 'start', { revision });
	await scenario(control.nodeId, { check: 'failure', restarts: 3 });

	revision = await stage(
		truck,
		'exampleco-meter',
		'1.4.0',
		meterSettings('meter-truck2.site.example')
	);
	await act(truck.nodeId, 'start', { revision });
	await scenario(truck.nodeId, { unreadable: true });

	await stage(migrated, 'exampleco-meter', '1.4.0', meterSettings('meter-edit.site.example'), {
		migration: true
	});
}
