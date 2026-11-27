import { createSocket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { get } from 'node:http';
import { isIP } from 'node:net';

export const routeSocket = '/run/hub-route/lookup.sock';

// Run only in the Docker host's network namespace. Connecting UDP selects the source
// interface for this particular destination without sending a packet to it.
export async function routeAddress(ip) {
  const socket = createSocket(isIP(ip) === 6 ? 'udp6' : 'udp4');
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(4646, ip, resolve);
    });
    return socket.address().address;
  } finally { socket.close(); }
}

// The manager sends only a resolved destination IP over a private local socket.
// Its own (usually bridged) network namespace is never used for route selection.
export async function dockerHostFor(nomadAddress) {
  const hostname = new URL(nomadAddress).hostname.replace(/^\[|\]$/g, '');
  const { address } = await lookup(hostname);
  return new Promise(resolve => {
    const req = get({ socketPath: routeSocket, path: `/${address}`, signal: AbortSignal.timeout(2000) }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('error', () => resolve(null));
      res.on('end', () => resolve(res.statusCode === 200 ? body : null));
    });
    req.on('error', () => resolve(null));
  });
}
