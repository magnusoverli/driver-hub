import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { expect, RequestError } from './errors.js';
import { checkDeclaration } from './settings.js';
import { parseTag, readRecord } from './release.js';
import { GitHubReleases } from './github.js';

const repository = 'VideoIPath/VideoIPath_External_Drivers';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function buildOci(context, workspace, platform) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'buildx', 'build', '--platform', platform, '--provenance=false', '--sbom=false',
      '--output', 'type=oci,dest=image.tar', '--metadata-file', 'metadata.json', context
    ], { cwd: workspace, stdio: 'ignore', timeout: 30 * 60 * 1000, windowsHide: true });
    child.on('error', () => reject(new RequestError(503, 'Docker Buildx is unavailable')));
    child.on('close', code => code === 0 ? resolve() : reject(new RequestError(422, 'Buildx failed to build this driver')));
  });
}

// Whether this manager can build: the image ships the Docker CLI with Buildx (the builder target)
// and reaches a Docker daemon. Administrators turn builds on in the web interface only if it can.
export async function buildxAvailable() {
  const succeeds = args => new Promise(resolve => {
    const child = spawn('docker', args, { stdio: 'ignore', timeout: 15 * 1000, windowsHide: true });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0));
  });
  // `docker info` fails when no daemon answers; `buildx version` when the plugin is missing.
  return await succeeds(['buildx', 'version']) && succeeds(['info', '--format', '{{.ServerVersion}}']);
}

export class Builds {
  constructor(store, build = buildOci, source = new GitHubReleases()) {
    this.store = store;
    this.build = build;
    this.source = source;
    this.busy = false;
  }

  async create(input) {
    expect(!this.busy, 'A source build is already running', 409);
    const { commit, directory, driverId, platform = 'linux/amd64' } = input;
    const version = `0.0.0-local.${randomUUID()}`;
    const identity = parseTag(`drivers/${driverId}/v${version}`);
    expect(identity && identity.driverId === driverId, 'Invalid driver ID');
    expect(typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit), 'Specify a full upstream Git commit');
    expect(typeof directory === 'string' && /^(Drivers|examples)(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)+$/.test(directory),
      'Expected a driver directory under Drivers or examples');
    expect(['linux/amd64', 'linux/arm64'].includes(platform), 'Unsupported build platform');
    this.busy = true;
    let workspace;
    try {
      workspace = await mkdtemp(join(tmpdir(), 'driverhub-build-'));
      const declaration = input.configuration ?? await this.source.sourceConfig(commit, directory);
      expect(declaration, 'No configuration declaration at that revision; supply configuration explicitly', 422);
      const configuration = checkDeclaration(declaration);
      await this.build(`https://github.com/${repository}.git#${commit}:${directory}`, workspace, platform);
      const meta = JSON.parse(await readFile(join(workspace, 'metadata.json'), 'utf8'));
      const archive = join(workspace, 'image.tar.gz');
      await pipeline(createReadStream(join(workspace, 'image.tar')), createGzip(), createWriteStream(archive));
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(archive)) digest.update(chunk);
      const configBytes = Buffer.from(JSON.stringify(configuration));
      const manifestBytes = Buffer.from(JSON.stringify({
        schemaVersion: 1, driverId, displayName: driverId, version, origin: 'customer',
        source: { commit, directory }, configuration: { file: 'driver-config.json', sha256: sha(configBytes) },
        image: { digest: meta['containerimage.digest'], platforms: [platform],
          archive: 'image.oci.tar.gz', archiveSha256: digest.digest('hex') }
      }));
      const record = readRecord(manifestBytes, identity);
      return await this.store.save({ detail: { record, configuration }, manifestBytes, configBytes }, createReadStream(archive));
    } finally {
      this.busy = false;
      if (workspace) await rm(workspace, { recursive: true, force: true });
    }
  }
}
