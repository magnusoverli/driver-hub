// Shared by the manager and the independently installed host updater. Never use a
// request-supplied registry, repository, asset URL, Compose project or command.
export const repository = 'magnusoverli/driver-hub';
export const image = `ghcr.io/${repository}`;
export const stable = /^v(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
export const formatEpoch = 1; // Bump before introducing an incompatible persisted-data format.
export function newer(candidate, installed) {
  if (!stable.test(candidate) || !stable.test(installed)) return false;
  const a = candidate.slice(1).split('.').map(Number), b = installed.slice(1).split('.').map(Number);
  return (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0;
}

async function json(url, request) {
  const r = await request(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Driver-Hub-Updates' } });
  if (!r.ok) { await r.body?.cancel(); throw new Error('Release service unavailable'); }
  const chunks = []; let size = 0;
  for await (const c of r.body) {
    if ((size += c.length) > 512 * 1024) throw new Error('Oversized release metadata');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

export async function findUpdate(installed, arch = process.arch, request = fetch) {
  const release = await json(`https://api.github.com/repos/${repository}/releases/latest`, request);
  if (release.draft || release.prerelease || !stable.test(release.tag_name)) throw new Error('Invalid stable release');
  const tag = release.tag_name;
  if (!newer(tag, installed)) return null;
  const result = { version: tag, notes: String(release.body ?? '').slice(0, 48000), readiness: 'publishing' };
  const asset = release.assets?.find(a => a.name === 'managed-update.json' && a.state === 'uploaded');
  if (!asset) return result;
  const manifest = await json(`https://github.com/${repository}/releases/download/${tag}/managed-update.json`, request);
  if (manifest.version !== tag || !/^sha256:[a-f0-9]{64}$/.test(manifest.digest)) throw new Error('Invalid release manifest');
  const platform = { x64: 'linux/amd64', arm64: 'linux/arm64' }[arch];
  if (manifest.epoch !== formatEpoch || !manifest.platforms?.includes(platform))
    return { ...result, readiness: 'manual' };
  return { ...result, readiness: 'ready', digest: manifest.digest };
}
