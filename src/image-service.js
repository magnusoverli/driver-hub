// The image service Driver Hub runs on every Nomad client. Docker on that client pulls driver
// images from it at 127.0.0.1. It keeps a copy of every image Hub lists, fetched from the manager
// or from the copies on other clients, so a driver can start while the manager is down.
import { readFile } from 'node:fs/promises';
import { distributionServer } from './distribution.js';
import { ImageCopies, parseWanted } from './image-copies.js';
import { copyReceipt, prunePackages } from './image-distribution.js';
import { Images } from './images.js';

const root = process.env.DRIVER_HUB_IMAGES_DIR;
if (!root) throw new Error('Set DRIVER_HUB_IMAGES_DIR to the directory for image copies');
const port = Number(process.env.PORT ?? 5480);
// Rendered by Nomad from the job's Variable; changes are picked up on the next round.
const wantedFile = process.env.DRIVER_HUB_WANTED_FILE;
// This copy's own address, so it does not try to fetch from itself.
const self = process.env.NOMAD_ADDR_http && `http://${process.env.NOMAD_ADDR_http}`;

const images = new Images(root);
const copies = new ImageCopies(images);
await prunePackages(process.env.NOMAD_TASK_DIR, process.env.DRIVER_HUB_PACKAGE_FILE)
  .catch(error => console.error('Could not remove an old image service archive:', error.code));
// Null until Hub's list has been read: without one, nothing is fetched or removed.
let wanted = null;
let missing = wantedFile ? null : 0;
let receipt = null;

async function refresh() {
  if (!wantedFile) return;
  const parsed = parseWanted(await readFile(wantedFile, 'utf8').catch(() => ''));
  if (parsed) wanted = { ...parsed, sources: parsed.sources.filter(source => source !== self) };
}

async function round() {
  try {
    await refresh();
    if (wanted) {
      ({ missing } = await copies.sync(wanted));
      receipt = missing === 0 ? copyReceipt(wanted.images) : null;
    }
  } catch (error) {
    missing = receipt = null;
    console.error('Image copy round failed:', error?.code ?? error?.message ?? 'unknown');
  } finally {
    setTimeout(round, 10000).unref();
  }
}

distributionServer(images, {
  // A driver may start before its image arrived here: fetch it while Docker waits.
  fetchMissing: (key, digest, kind) => copies.onDemand(wanted, key, digest, kind),
  // Nomad's check: healthy once every listed image is here.
  extra: (req, res) => {
    if (req.url !== '/_hub/health') return false;
    const ready = missing === 0;
    // Nomad replaces a 200 response body with "nomad: http ok". On 203 it
    // records success and retains the receipt from the local image cache.
    res.writeHead(ready ? (receipt ? 203 : 200) : 503, { 'Content-Type': 'text/plain' });
    res.end(ready ? receipt ?? '0 images copied' : `${missing ?? 'unknown'} images still to copy`);
    return true;
  }
}).listen(port, '0.0.0.0', () => console.log(`Driver Hub image service on port ${port}`));
round();
