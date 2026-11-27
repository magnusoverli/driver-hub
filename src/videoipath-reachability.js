import { get } from 'node:https';

// Ask the saved driver route, not just the TLS listener. No credentials, node_id, upgrade,
// or redirects: this cannot register a device or displace an existing driver.
export function checkVideoIPathEndpoint(endpoint, timeoutMs = 4000) {
  const url = new URL(endpoint);
  url.protocol = 'https:';
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
