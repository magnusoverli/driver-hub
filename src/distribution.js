import { createServer } from 'node:http';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const imagePath = /^\/v2\/driverhub\/([0-9a-f]{64})\/(manifests|blobs)\/(sha256:[0-9a-f]{64})$/;
const indexPath = /^\/_hub\/images\/([0-9a-f]{64})$/;

// Pull-only OCI Distribution endpoints for Hub's verified images, and the verified index of each
// image, which copies on Nomad clients read to fetch one. Nothing here accepts uploads or
// credentials. `fetchMissing(key, digest, kind)` may fetch an image that is not here yet before
// answering; `extra(request, response)` answers further routes and returns whether it did.
export function imageHandler(images, { fetchMissing, extra } = {}) {
  return async (req, res) => {
    let file;
    try {
      if (await extra?.(req, res)) return;
      res.setHeader('Docker-Distribution-Api-Version', 'registry/2.0');
      if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405).end();
      const path = req.url.split('?')[0];
      if (path === '/v2/' || path === '/v2') return res.writeHead(200).end();
      const index = indexPath.exec(path);
      if (index) {
        const info = await images.info(index[1]);
        if (!info) return res.writeHead(404).end();
        const body = JSON.stringify(info);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      const match = imagePath.exec(path);
      if (!match) return res.writeHead(404).end();
      const [, key, kind, digest] = match;
      let item = (await images.info(key))?.objects[digest];
      if (!item && fetchMissing && await fetchMissing(key, digest, kind)) item = (await images.info(key))?.objects[digest];
      if (!item || (kind === 'manifests') !== (item.role === 'manifest')) return res.writeHead(404).end();
      file = await open(join(images.root, key, item.file), 'r');
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== item.size) return res.writeHead(503).end();
      res.writeHead(200, {
        'Content-Type': item.mediaType, 'Content-Length': item.size, 'Docker-Content-Digest': digest
      });
      if (req.method === 'HEAD') return res.end();
      await pipeline(file.createReadStream(), res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
      else res.destroy();
    } finally { await file?.close(); }
  };
}

export function distributionServer(images, options) {
  return createServer(imageHandler(images, options));
}
