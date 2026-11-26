import { InvalidRelease } from './release.js';

const base = 'https://api.github.com/repos/VideoIPath/VideoIPath_External_Drivers';
const metadataLimit = 4 * 1024 * 1024;
const archiveLimit = 2 * 1024 ** 3;

export class UpstreamError extends Error {}

export class GitHubReleases {
  constructor(request = fetch) {
    this.request = request;
  }

  async open(path, accept, timeout, allowMissing) {
    try {
      const response = await this.request(`${base}${path}`, {
        headers: { Accept: accept, 'User-Agent': 'driver-hub' },
        signal: AbortSignal.timeout(timeout)
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (allowMissing && response.status === 404) return null;
        throw new UpstreamError(`GitHub returned HTTP ${response.status}`);
      }
      if (!response.body) throw new UpstreamError('GitHub returned no response body');
      return response.body;
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError('GitHub request failed', { cause: error });
    }
  }

  async *chunks(body, limit) {
    let size = 0;
    try {
      for await (const chunk of body) {
        size += chunk.length;
        if (size > limit) throw new UpstreamError('GitHub response exceeds size limit');
        yield chunk;
      }
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError('GitHub transfer interrupted', { cause: error });
    }
  }

  async read(path, accept, limit, allowMissing = false) {
    const body = await this.open(path, accept, 15000, allowMissing);
    if (!body) return null;
    const chunks = [];
    for await (const chunk of this.chunks(body, limit)) chunks.push(chunk);
    return Buffer.concat(chunks);
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

  async sourceConfig(commit, directory) {
    const bytes = await this.read(`/contents/${directory}/driver-config.json?ref=${commit}`,
      'application/vnd.github.raw+json', 256 * 1024, true);
    if (!bytes) return null;
    try {
      return JSON.parse(bytes);
    } catch {
      throw new InvalidRelease('Invalid configuration declaration in source revision');
    }
  }

  assetPath(asset) {
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0) throw new InvalidRelease('Invalid release asset ID');
    return `/releases/assets/${asset.id}`;
  }

  asset(asset) {
    return this.read(this.assetPath(asset), 'application/octet-stream', 256 * 1024);
  }

  async *archive(asset) {
    const body = await this.open(this.assetPath(asset), 'application/octet-stream', 30 * 60 * 1000);
    yield* this.chunks(body, archiveLimit);
  }
}
