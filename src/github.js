import { InvalidRelease } from './release.js';

const base = 'https://api.github.com/repos/VideoIPath/VideoIPath_External_Drivers';
const metadataLimit = 4 * 1024 * 1024;

export class UpstreamError extends Error {}

export class GitHubReleases {
  constructor(request = fetch) {
    this.request = request;
  }

  async read(path, accept, limit, allowMissing = false) {
    try {
      const response = await this.request(`${base}${path}`, {
        headers: { Accept: accept, 'User-Agent': 'driver-hub' },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (allowMissing && response.status === 404) return null;
        throw new UpstreamError(`GitHub returned HTTP ${response.status}`);
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) throw new UpstreamError('GitHub response exceeds size limit');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError('GitHub request failed', { cause: error });
    }
  }

  async metadata(path, allowMissing) {
    const bytes = await this.read(path, 'application/vnd.github+json', metadataLimit, allowMissing);
    if (!bytes) return null;
    try {
      return JSON.parse(bytes);
    } catch {
      throw new UpstreamError('Invalid GitHub response');
    }
  }

  async *list() {
    for (let page = 1; ; page++) {
      const releases = await this.metadata(`/releases?per_page=50&page=${page}`);
      if (!Array.isArray(releases)) throw new UpstreamError('Invalid GitHub release list');
      yield* releases;
      if (releases.length < 50) break;
    }
  }

  byTag(tag) {
    return this.metadata(`/releases/tags/${encodeURIComponent(tag)}`, true);
  }

  asset(asset) {
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0) throw new InvalidRelease('Invalid release asset ID');
    return this.read(`/releases/assets/${asset.id}`, 'application/octet-stream', 256 * 1024);
  }
}
