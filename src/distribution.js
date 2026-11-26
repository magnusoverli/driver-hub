import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

// Pull-only OCI Distribution endpoints. No credentials or state from the manager.
export function distributionServer(images) {
  return createServer(async (req, res) => {
    try {
      res.setHeader('Docker-Distribution-Api-Version', 'registry/2.0');
      if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405).end();
      if (req.url === '/v2/' || req.url === '/v2') return res.writeHead(200).end();
      const match = /^\/v2\/driverhub\/([0-9a-f]{64})\/(manifests|blobs)\/(sha256:[0-9a-f]{64})$/.exec(req.url.split('?')[0]);
      if (!match) return res.writeHead(404).end();
      const [, key, kind, digest] = match;
      const item = (await images.info(key))?.objects[digest];
      if (!item || (kind === 'manifests') !== (item.role === 'manifest')) return res.writeHead(404).end();
      res.writeHead(200, {
        'Content-Type': item.mediaType, 'Content-Length': item.size, 'Docker-Content-Digest': digest
      });
      if (req.method === 'HEAD') return res.end();
      await pipeline(createReadStream(join(images.root, key, item.file)), res);
    } catch {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    }
  });
}
