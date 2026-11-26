import { Catalog } from './catalog.js';
import { GitHubReleases } from './github.js';
import { createApi } from './http.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ReleaseStore } from './release-store.js';
import { Builds } from './builds.js';
import { Deployments } from './deployments.js';
import { Images } from './images.js';
import { Nomad } from './nomad.js';

const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.DRIVER_HUB_DATA_DIR ?? join(homedir(), '.driver-hub');
const store = new ReleaseStore(join(dataDir, 'releases'));
const deployments = new Deployments({
  store, images: new Images(process.env.DRIVER_HUB_IMAGES_DIR ?? join(dataDir, 'images')),
  nomad: new Nomad(process.env.NOMAD_ADDR, process.env.NOMAD_TOKEN, process.env.NOMAD_NAMESPACE),
  datacenters: (process.env.NOMAD_DATACENTERS ?? 'dc1').split(',').map(dc => dc.trim()),
  registry: process.env.DRIVER_HUB_IMAGE_HOST
});
const host = process.env.HOST ?? '127.0.0.1';
const token = process.env.DRIVER_HUB_ADMIN_TOKEN;
if (host !== '127.0.0.1' && !token) throw new Error('Non-loopback management requires DRIVER_HUB_ADMIN_TOKEN');
const builds = process.env.DRIVER_HUB_BUILDS === 'true' ? new Builds(store) : null;
const server = createApi(new Catalog(new GitHubReleases()), store, { deployments, builds, token });
server.listen(port, host, () => {
  console.log(`Driver Hub API: http://${host}:${server.address().port}/api/v1/releases`);
});
