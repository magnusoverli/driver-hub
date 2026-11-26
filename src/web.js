import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
const encodings = [['br', '.br'], ['gzip', '.gz']];

// Hashes of the inline bootstrap scripts let the policy forbid every other inline script.
function contentSecurityPolicy(html) {
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  return [
    "default-src 'self'", `script-src 'self' ${hashes.join(' ')}`.trim(), "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'none'"
  ].join('; ');
}

// Serves the built single-page frontend from the same origin as the API. Unknown routes return
// the application shell, which then routes in the browser; missing assets return 404.
export class WebApp {
  static async open(root) {
    const directory = resolve(root);
    let html;
    try { html = await readFile(join(directory, 'index.html'), 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const app = new WebApp();
    app.root = directory;
    app.documentHeaders = {
      'Content-Security-Policy': contentSecurityPolicy(html), 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    };
    return app;
  }

  resolve(pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return null; }
    if (decoded.includes('\0') || decoded.split('/').some(segment => segment.startsWith('.'))) return null;
    const file = resolve(this.root, `.${decoded}`);
    return file === this.root || file.startsWith(this.root + sep) ? file : null;
  }

  async file(path) {
    try {
      const info = await stat(path);
      return info.isFile() ? info : null;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
      throw error;
    }
  }

  async serve(request, response) {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end('Method not allowed');
    }
    let path = this.resolve(pathname);
    let info = path && await this.file(path);
    // App routes may end in something that looks like an extension, such as a release version
    // (/catalog/meter/1.4.0). Only extensions the app is actually built with mark a missing file.
    if (!info && path && !Object.hasOwn(types, extname(path))) {
      path = join(this.root, 'index.html');
      info = await this.file(path);
    }
    if (!info) {
      response.writeHead(path ? 404 : 400, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      return response.end(path ? 'Not found' : 'Bad request');
    }
    const type = types[extname(path)] ?? 'application/octet-stream';
    const immutable = pathname.startsWith('/_app/immutable/');
    const headers = {
      'Content-Type': type, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...(type.startsWith('text/html') ? this.documentHeaders : {})
    };
    const accepted = request.headers['accept-encoding'] ?? '';
    for (const [encoding, suffix] of encodings) {
      if (!new RegExp(`\\b${encoding}\\b`).test(accepted)) continue;
      const compressed = await this.file(path + suffix);
      if (compressed) {
        headers['Content-Encoding'] = encoding;
        [path, info] = [path + suffix, compressed];
        break;
      }
    }
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}${headers['Content-Encoding'] ? '-' + headers['Content-Encoding'] : ''}"`;
    headers.ETag = etag;
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, headers);
      return response.end();
    }
    headers['Content-Length'] = info.size;
    response.writeHead(200, headers);
    if (request.method === 'HEAD') return response.end();
    createReadStream(path).on('error', () => response.destroy()).pipe(response);
  }
}
