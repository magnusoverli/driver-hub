import { Catalog } from './catalog.js';
import { GitHubReleases } from './github.js';
import { createApi } from './http.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ReleaseStore } from './release-store.js';
import { Builds } from './builds.js';
import { Deployments } from './deployments.js';
import { Images } from './images.js';
import { Site } from './site.js';
import { Operations } from './operations.js';
import { LocalUsers } from './local-users.js';
import { OperatorSessions } from './operator-sessions.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DeploymentLabels } from './labels.js';
import { WebApp } from './web.js';

const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.DRIVER_HUB_DATA_DIR ?? join(homedir(), '.driver-hub');
const store = new ReleaseStore(join(dataDir, 'releases'));
const web = await WebApp.open(process.env.DRIVER_HUB_WEB_DIR ?? fileURLToPath(new URL('../web/build', import.meta.url)));
const site = await Site.open(join(dataDir, 'site'), {
  address: process.env.NOMAD_ADDR, token: process.env.NOMAD_TOKEN, namespace: process.env.NOMAD_NAMESPACE ?? 'default',
  datacenters: (process.env.NOMAD_DATACENTERS ?? 'dc1').split(',').map(dc => dc.trim())
}, { keyFile: process.env.DRIVER_HUB_SITE_KEY_FILE });
const deploymentServices = { store, images: new Images(process.env.DRIVER_HUB_IMAGES_DIR ?? join(dataDir, 'images')),
  registry: process.env.DRIVER_HUB_IMAGE_HOST, labels: await DeploymentLabels.open(join(dataDir, 'labels')) };
const host = process.env.HOST ?? '127.0.0.1';
const token = process.env.DRIVER_HUB_ADMIN_TOKEN;
const viewerToken = process.env.DRIVER_HUB_VIEWER_TOKEN;
if (viewerToken && (!token || viewerToken === token)) throw new Error('Viewer access requires a distinct admin token');
const localUsers = await LocalUsers.open(join(dataDir, 'auth'));
if (!localUsers.list().length && process.env.DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE) {
  const password = (await readFile(process.env.DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE, 'utf8')).replace(/\r?\n$/, '');
  await localUsers.create({ username: process.env.DRIVER_HUB_BOOTSTRAP_USERNAME ?? 'admin', password, role: 'admin' });
}
if (!localUsers.list().length && !token) throw new Error('First setup requires DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE or DRIVER_HUB_ADMIN_TOKEN');
const sessions = new OperatorSessions(localUsers);
const builds = process.env.DRIVER_HUB_BUILDS === 'true' ? new Builds(store) : null;
const operations = new Operations(join(dataDir, 'operations'));
const server = createApi(new Catalog(new GitHubReleases()), store, {
  get deployments() { return Deployments.forSite(site, deploymentServices); }, site, builds, operations, token, viewerToken,
  sessions, localUsers, web
});
server.listen(port, host, () => {
  const origin = `http://${host}:${server.address().port}`;
  console.log(`Driver Hub API: ${origin}/api/v1/releases`);
  console.log(web ? `Driver Hub web app: ${origin}/` : 'Driver Hub web app: not built (run npm run build in web/)');
});
