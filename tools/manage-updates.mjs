// Linux host process. Start via systemd, as the installation's Compose owner.
// The manager can name a release, never a command, path, image or Compose file.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { findUpdate, image, newer, stable } from '../src/hub-release.js';

const exec = promisify(execFile), services = ['manager', 'host-route'];
const active = ['downloading', 'restarting', 'verifying', 'rollingBack'];
const digestPattern = /^sha256:[0-9a-f]{64}$/;
export function withPin(text, ref) {
  const lines = text.split('\n');
  const keys = lines.map((l, i) => /^\s*(?:export\s+)?DRIVER_HUB_IMAGE\s*=/.test(l) ? i : -1).filter(i => i >= 0);
  if (keys.length > 1 || (keys.length && !/^DRIVER_HUB_IMAGE=[^\s'"`\\#]*\r?$/.test(lines[keys[0]])))
    throw Error('The image override must be a simple assignment in .env.');
  if (keys.length) lines[keys[0]] = `DRIVER_HUB_IMAGE=${ref}`;
  else { if (lines.at(-1) === '') lines.pop(); lines.push(`DRIVER_HUB_IMAGE=${ref}`, ''); }
  return lines.join('\n');
}

async function atomic(path, text, mode = 0o600) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(tmp, text, { mode, flag: 'wx', flush: true }); await rename(tmp, path); }
  finally { await unlink(tmp).catch(() => {}); }
}
async function maybe(path) {
  return readFile(path, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
}

export function hostTools({ directory, project, files }, repositoryImage = image) {
  const args = ['compose', '--project-directory', directory, '-p', project, ...files.flatMap(f => ['-f', f])];
  const docker = async (argv, pin) => {
    const env = { ...process.env }; delete env.DRIVER_HUB_IMAGE;
    if (pin) env.DRIVER_HUB_IMAGE = pin;
    return (await exec('docker', argv, { cwd: directory, env, timeout: 600000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
  };
  const compose = (argv, pin) => docker([...args, ...argv], pin);
  const envPath = resolve(directory, '.env');
  return {
    async previous(installed, target) {
      const config = JSON.parse(await compose(['config', '--format', 'json'], target));
      if (!services.every(s => config.services?.[s]?.image === target)) throw Error('Unsupported Compose image pin');
      // A shadowed/non-writable pin must be caught before stopping the manager.
      const stat = await lstat(envPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
      if (stat && !stat.isFile()) throw Error('Unsupported .env file');
      withPin(await maybe(envPath), target);
      const previous = [];
      for (const service of services) {
        const id = await compose(['ps', '-q', service]);
        const container = JSON.parse(await docker(['inspect', id]))[0];
        const labels = container.Config.Labels;
        if (labels['com.docker.compose.project'] !== project ||
          labels['com.docker.compose.project.working_dir'] !== directory ||
          labels['com.docker.compose.project.config_files'] !== files.join(',') ||
          labels['org.opencontainers.image.version'] !== installed)
          throw Error('Compose installation or version mismatch');
        const hashLine = await compose(['config', '--hash', service]);
        if (hashLine.trim().split(/\s+/).at(-1) !== labels['com.docker.compose.config-hash'])
          throw Error('Unapplied Compose changes; reconcile the installation first');
        const info = JSON.parse(await docker(['image', 'inspect', container.Image]))[0];
        const ref = info.RepoDigests?.find(d => d.startsWith(`${repositoryImage}@`) && digestPattern.test(d.split('@')[1]));
        if (!ref) throw Error('Missing rollback image');
        previous.push(ref);
      }
      if (previous[0] !== previous[1]) throw Error('Installation images differ');
      return previous[0];
    },
    pull: ref => docker(['pull', ref]),
    async switchTo(ref) {
      const stat = await lstat(envPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
      if (stat && !stat.isFile()) throw Error('Unsupported .env file');
      await atomic(envPath, withPin(await maybe(envPath), ref), stat ? stat.mode & 0o777 : 0o600);
      const config = JSON.parse(await compose(['config', '--format', 'json']));
      if (!services.every(s => config.services?.[s]?.image === ref)) throw Error('Stored image pin is not effective');
      await compose(['up', '-d', '--no-build', '--no-deps', '--pull', 'never', ...services]);
    },
    async verify(version) {
      // Use the container's actual API port. This exercises the backend listener
      // and requires the built frontend, not just a running container or label.
      const probe = `const base='http://127.0.0.1:'+(process.env.PORT||8080);
        const get=p=>fetch(base+p,{signal:AbortSignal.timeout(2500)});
        const b=await (await get('/api/v1/build')).json();const ui=await get('/');
        if(!ui.ok||!(await ui.text()).includes('<!doctype html>')||b.version!==process.argv[1])process.exit(1)`;
      for (let i = 0; i < 25; i++) {
        try { await compose(['exec', '-T', 'manager', 'node', '--input-type=module', '-e', probe, version]); return; }
        catch { if (i < 24) await delay(1500); }
      }
      throw Error('Replacement did not become ready');
    }
  };
}

export async function runUpdate(job, tools, record) {
  let switching = false;
  try {
    // Resolve the published digest again outside the web process.
    const release = await (tools.lookup ?? findUpdate)(job.installed);
    if (release?.version !== job.version || release.readiness !== 'ready' || release.digest !== job.digest)
      throw Error('Release no longer eligible');
    const ref = `${image}@${release.digest}`;
    job.previous = await tools.previous(job.installed, ref);
    await tools.pull(ref);
    await record({ ...job, phase: 'restarting' }); switching = true;
    await tools.switchTo(ref);
    await record({ ...job, phase: 'verifying' }); await tools.verify(job.version);
    await record({ ...job, phase: 'succeeded' });
  } catch {
    if (switching) await rollback(job, tools, record);
    else await record({ ...job, phase: 'failed', message: 'Update preflight or download failed. The running installation was not changed.' });
  }
}
async function rollback(job, tools, record) {
  await record({ ...job, phase: 'rollingBack' });
  try { await tools.switchTo(job.previous); await tools.verify(job.installed); }
  catch { await record({ ...job, phase: 'recoveryRequired', message: 'Automatic rollback could not be verified. Check the Compose installation on the host.' }); return; }
  await record({ ...job, phase: 'rolledBack', message: 'The update did not finish. The previous version was restored and verified.' });
}

async function main() {
  const directory = process.cwd(), project = process.env.HUB_COMPOSE_PROJECT;
  if (!project || !/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw Error('Set HUB_COMPOSE_PROJECT');
  const files = (process.env.HUB_COMPOSE_FILES || 'compose.yaml').split(':').map(p => resolve(directory, p));
  const tools = hostTools({ directory, project, files });
  const root = process.env.STATE_DIRECTORY || '/var/lib/driver-hub-update';
  const runtime = process.env.RUNTIME_DIRECTORY || '/run/driver-hub-update';
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = resolve(root, 'last.json'), socket = resolve(runtime, 'control.sock');
  let state = JSON.parse((await maybe(file)) || '{"phase":"idle","version":""}'), busy = false;
  const record = async value => { await atomic(file, JSON.stringify(value)); state = value; };
  if (active.includes(state.phase)) {
    if (state.phase === 'downloading') await record({ ...state, phase: 'failed', message: 'Download interrupted. Retry the update.' });
    else await rollback(state, tools, record);
  }
  await unlink(socket).catch(e => { if (e.code !== 'ENOENT') throw e; });
  const server = createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.method === 'GET' && req.url === '/state') {
      const { phase, version, message } = state; return send(200, { phase, version, message });
    }
    if (req.method !== 'POST' || req.url !== '/update') return send(404, {});
    if (busy || state.phase === 'recoveryRequired') return send(409, {});
    busy = true;
    try {
      let text = '';
      for await (const chunk of req) { if ((text += chunk).length > 512) throw Error(); }
      const { installed, version, digest } = JSON.parse(text);
      if (!stable.test(installed) || !newer(version, installed) || !digestPattern.test(digest)) throw Error();
      const job = { installed, version, digest, phase: 'downloading' };
      await record(job); send(200, { accepted: true });
      await runUpdate(job, tools, record);
    } catch { if (!res.headersSent) send(400, {}); }
    finally { busy = false; }
  });
  server.requestTimeout = 10000;
  server.listen(socket, () => chmod(socket, 0o660).catch(() => process.exit(1)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => { console.error(`Cannot start ${basename(process.argv[1])}; check configuration and journal permissions`); process.exit(1); });
