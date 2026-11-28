import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';
import { randomUUID } from 'node:crypto';

// VideoIPath matches the route only with node_id present. Use a disposable ID,
// never a deployed device's identity, and send no credentials or WebSocket upgrade.
export function checkVideoIPathEndpoint(endpoint, timeoutMs = 4000) {
  const url = new URL(endpoint);
  url.searchParams.set('node_id', randomUUID());
  const secure = url.protocol === 'wss:';
  url.protocol = secure ? 'https:' : 'http:';
  const get = secure ? httpsGet : httpGet;
  return new Promise(resolve => {
    const request = get(url, { agent: false, rejectUnauthorized: true }, response => {
      const code = response.statusCode;
      finish(code === 401 || code === 403 ? 'auth_required' :
        code === 426 ? 'upgrade_required' : code === 404 ? 'not_found' : 'unexpected', code);
    });
    const finish = (state, httpStatus = null) => {
      clearTimeout(timer);
      request.destroy();
      resolve({ endpoint, state, httpStatus });
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    request.once('error', error => finish(
      /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET/.test(error.code ?? '') ? 'tls_failed' : 'unreachable'));
  });
}
