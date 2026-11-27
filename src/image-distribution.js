import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import { isIP } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from './errors.js';

// Driver Hub distributes driver images itself. It runs an image service on every eligible Nomad
// client (a system job), and driver jobs pull from the copy on their own machine. Docker accepts
// plain HTTP from a registry at 127.0.0.0/8, so this needs no addresses, certificates or
// registry configuration on the clients.
export const IMAGE_PORT = 5480;
export const IMAGE_HOST = `127.0.0.1:${IMAGE_PORT}`;
export const IMAGE_JOB = 'driverhub-images';
export const IMAGE_VARIABLE = `nomad/jobs/${IMAGE_JOB}`;
const CHECK = 'images-copied';
// Task events that mean a pending allocation will not start without someone acting.
const failureEvents = new Set(['Failed Artifact Download', 'Driver Failure', 'Setup Failure', 'Failed Validation',
  'Not Restarting', 'Template Failure', 'Killing', 'Restarting']);
const second = 1e9;
const packageFilename = pkg => `image-service-${pkg.sha256}.tar.gz`;
const versionedPackage = /^image-service-[0-9a-f]{64}\.tar\.gz$/;

// The task's local directory survives upgrades. Keep the loaded archive for restarts, but
// don't accumulate a full archive per release alongside the retained driver images.
export async function prunePackages(directory, current) {
  if (!directory || !versionedPackage.test(current)) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== current &&
      (entry.name === 'image-service.tar.gz' || versionedPackage.test(entry.name))) {
      await unlink(join(directory, entry.name));
    }
  }
}

async function readPackageAt(directory) {
  try {
    const meta = JSON.parse(await readFile(join(directory, 'image-service.json'), 'utf8'));
    if (!/^[0-9a-f]{64}$/.test(meta.sha256) || !/^driverhub\/image-service:[\w.-]+$/.test(meta.tag) ||
      !/^[a-z0-9]+$/.test(meta.arch)) return null;
    return { ...meta, file: join(directory, 'image-service.tar.gz') };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

// The image service ships as gzipped `docker save` archives built with Hub's container image,
// one per client architecture, in `<directory>/<arch>/`. An image from before that keeps one
// archive directly in `<directory>`. Native installations without one cannot distribute images.
export async function readPackages(directory = fileURLToPath(new URL('../image-service/', import.meta.url))) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const found = [await readPackageAt(directory)];
  for (const entry of entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    found.push(await readPackageAt(join(directory, entry.name)));
  }
  const byArch = new Map();
  for (const pkg of found) if (pkg && !byArch.has(pkg.arch)) byArch.set(pkg.arch, pkg);
  return [...byArch.values()];
}

// Serves the packages to the Nomad clients, which fetch theirs once as the image job's artifact
// and check it against the SHA-256 in the job.
export function packageRoute(packages) {
  const byPath = new Map(packages.map(pkg => [`/_hub/${packageFilename(pkg)}`, pkg]));
  // The unversioned URL remains available to jobs created before package URLs were pinned.
  if (packages.length === 1) byPath.set('/_hub/image-service.tar.gz', packages[0]);
  return async (req, res) => {
    const pkg = byPath.get(req.url);
    if (!pkg) return false;
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405).end();
      return true;
    }
    const { size } = await stat(pkg.file);
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': size });
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(pkg.file), res);
    return true;
  };
}

export function sourceUrl(host, port) {
  return `http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

// The manager address as seen by Nomad clients. A port on an IPv6 literal requires brackets.
export function parseAddress(value, defaultPort) {
  const message = 'Enter the Driver Hub hostname or IP, optionally with a port, without a URL scheme or path.';
  expect(typeof value === 'string' && value.length <= 255, message);
  if (isIP(value) === 6) return { host: value, port: defaultPort };
  const match = /^(\[[\da-f:.]+\]|[\w.-]+)(?::(\d+))?\/?$/i.exec(value);
  expect(match, message);
  let url;
  try { url = new URL(`http://${value}`); } catch { expect(false, message); }
  const port = match[2] === undefined ? defaultPort : Number(match[2]);
  if (match[2]) expect(port > 0 && port <= 65535, message);
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port };
}

// One task group per client architecture, each running the image service built for it.
export function imageServiceJob({ namespace, datacenters, source, packages }) {
  return {
    ID: IMAGE_JOB, Name: IMAGE_JOB, Namespace: namespace, Type: 'system', Datacenters: datacenters,
    Meta: { managed_by: 'driver-hub-images', package: packages.map(pkg => pkg.tag).join(' ') },
    TaskGroups: packages.map(pkg => imageServiceGroup(source, pkg))
  };
}

function imageServiceGroup(source, pkg) {
  // Nomad can overwrite a retained download without truncating it. Different archives must
  // never share a download destination, even if the new archive is shorter by just one byte.
  const filename = packageFilename(pkg);
  return {
    Name: `images-${pkg.arch}`, Count: 1,
    Constraints: [
      { LTarget: '${attr.kernel.name}', Operand: '=', RTarget: 'linux' },
      { LTarget: '${attr.cpu.arch}', Operand: '=', RTarget: pkg.arch }
    ],
    // Keep the copies when Nomad replaces the allocation on the same client.
    EphemeralDisk: { Sticky: true, Migrate: true, SizeMB: 2048 },
    Networks: [{ Mode: 'host', ReservedPorts: [{ Label: 'http', Value: IMAGE_PORT }] }],
    Tasks: [{
      Name: 'images', Driver: 'docker',
      Artifacts: [{ GetterSource: `${source}/_hub/${filename}`,
        GetterOptions: { checksum: `sha256:${pkg.sha256}`, archive: 'false' }, RelativeDest: 'local/' }],
      Config: { image: pkg.tag, load: filename, network_mode: 'host', force_pull: false,
        cap_drop: ['all'], readonly_rootfs: true },
      Env: { DRIVER_HUB_IMAGES_DIR: '/alloc/data/images', PORT: String(IMAGE_PORT),
        DRIVER_HUB_WANTED_FILE: '/local/wanted.json', DRIVER_HUB_PACKAGE_FILE: filename },
      // Tasks may read their own job's Variable without an ACL policy. Hub writes it first,
      // because rendering waits until it exists.
      Templates: [{ DestPath: 'local/wanted.json', ChangeMode: 'noop', Perms: '0444',
        EmbeddedTmpl: `{{ with nomadVar "${IMAGE_VARIABLE}" }}{{ .wanted }}{{ end }}` }],
      // All copies, whatever their architecture, register as one service so they can copy from
      // one another: the images they hold are the same.
      Services: [{ Name: IMAGE_JOB, Provider: 'nomad', PortLabel: 'http', Checks: [{
        Name: CHECK, Type: 'http', Path: '/_hub/health', Interval: 10 * second, Timeout: 2 * second
      }] }],
      // Deregistered first, so other copies stop fetching from it before it stops.
      Resources: { CPU: 100, MemoryMB: 128 }, KillTimeout: 5 * second, ShutdownDelay: 2 * second
    }]
  };
}

const fingerprintOf = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

export class ImageDistribution {
  // `address` is the installation override for the client-facing address saved with the site.
  // `packages` are the image service archives, one per client architecture.
  constructor({ images, site, packages = [], port, address, interval = 60000 }) {
    Object.assign(this, { images, site, packages, port, address, interval });
    this.pending = Promise.resolve();
    this.last = null;
    this.queued = false;
  }

  start() {
    this.trigger();
    this.timer = setInterval(() => this.trigger(), this.interval);
    this.timer.unref?.();
  }

  stop() { clearInterval(this.timer); }

  // Runs one reconciliation after any already running, coalescing bursts of changes.
  trigger() {
    if (this.queued) return this.pending;
    this.queued = true;
    this.pending = this.pending.then(() => { this.queued = false; return this.reconcile(); })
      .catch(() => {});
    return this.pending;
  }

  nomad() {
    const { nomad } = this.site.state;
    return nomad.address ? this.site.client(nomad) : null;
  }

  async reconcile() {
    const client = this.nomad();
    if (!client || !this.packages.length) return;
    let source = null;
    try {
      const { nomad } = this.site.state;
      // Never infer a download URL from the outgoing Nomad connection: behind NAT its local
      // interface can be private to this container. Resolve this before making any Nomad writes.
      const address = this.address || nomad.distributionAddress;
      expect(address, 'Set the Hub download address in Settings > Nomad cluster, or set DRIVER_HUB_DISTRIBUTION_ADDRESS.',
        409, 'distribution_address_required');
      const { host, port } = parseAddress(address, this.port);
      source = sourceUrl(host, port);
      const peers = (await client.services(IMAGE_JOB))
        .filter(s => typeof s?.Address === 'string' && Number.isSafeInteger(s.Port))
        .map(s => sourceUrl(s.Address, s.Port)).sort();
      const wanted = JSON.stringify({ images: await this.images.list(), sources: [source, ...new Set(peers)] });
      const current = await client.variable(IMAGE_VARIABLE);
      if (current?.Items?.wanted !== wanted) await client.putVariable(IMAGE_VARIABLE, { wanted });
      const job = imageServiceJob({ namespace: nomad.namespace, datacenters: nomad.datacenters, source,
        packages: this.packages });
      job.Meta.spec = fingerprintOf(job);
      const existing = await client.get(IMAGE_JOB);
      if (existing?.Meta?.spec !== job.Meta.spec || existing.Stop) await client.register(job);
      this.last = { at: new Date().toISOString(), source, error: null };
    } catch (error) {
      this.last = { at: new Date().toISOString(), source,
        error: { code: error.code ?? 'image_distribution_failed', message: error.message } };
    }
  }

  // What an administrator needs to know: whether the copies run, and whether they are complete.
  async status() {
    const client = this.nomad();
    if (!client) return { state: 'not_configured', running: 0, upToDate: 0, images: 0, source: null, problems: [] };
    const images = (await this.images.list()).length;
    const base = { images, source: this.last?.source ?? null, running: 0, upToDate: 0, problems: [] };
    if (!this.packages.length) return { ...base, state: 'unavailable', reason: 'no_package' };
    if (this.last?.error) return { ...base, state: 'failing', reason: this.last.error.code, detail: this.last.error.message };
    // Nomad retains failed allocations with desired status "run" even after replacing them.
    const allocations = (await client.allocations(IMAGE_JOB).catch(error => {
      if (error.status === 404) return [];
      throw error;
    })).filter(a => a.DesiredStatus === 'run' && !a.NextAllocation);
    const running = allocations.filter(a => a.ClientStatus === 'running');
    let upToDate = 0;
    for (const allocation of running) {
      const checks = await client.checks(allocation.ID).catch(() => null);
      if (Object.values(checks ?? {}).some(c => c.Check === CHECK && c.Status === 'success')) upToDate++;
    }
    // A client still fetching or loading the image service is starting, not failing.
    const problems = allocations.filter(a => a.ClientStatus !== 'running').flatMap(a => {
      const event = a.TaskStates?.images?.Events?.at(-1);
      const type = event && /^[A-Za-z][A-Za-z -]{0,47}$/.test(event.Type) ? event.Type : null;
      if (a.ClientStatus === 'pending' && !failureEvents.has(type)) return [];
      return [{ host: a.NodeName ?? null, status: a.ClientStatus, event: type }];
    });
    let state = 'starting';
    if (this.last && allocations.length) {
      if (upToDate === allocations.length) state = 'ready';
      else if (!running.length && problems.length) state = 'failing';
      else if (running.length && (upToDate < running.length || problems.length)) state = 'copying';
    }
    return { ...base, state, running: running.length, upToDate, problems };
  }
}
