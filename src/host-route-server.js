import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { release } from 'node:os';
import { routeAddress, routeSocket } from './host-route.js';

// Docker Desktop's Linux VM does not own the physical host's LAN interfaces.
// On Windows, Compose can supply the machine name instead of advertising a VM IP.
const desktop = /linuxkit|microsoft/i.test(release());
await rm(routeSocket, { force: true });
createServer(async (req, res) => {
  const ip = req.url.slice(1);
  if (req.method !== 'GET' || !isIP(ip)) return res.writeHead(400).end();
  try {
    const host = desktop ? process.env.DESKTOP_HOSTNAME : await routeAddress(ip);
    res.writeHead(host ? 200 : 404).end(host);
  } catch {
    res.writeHead(503).end();
  }
}).listen(routeSocket);
