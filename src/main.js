import { Catalog } from './catalog.js';
import { GitHubReleases } from './github.js';
import { createApi } from './http.js';
import { join } from 'node:path';
import { ReleaseStore } from './release-store.js';
import { Imports } from './imports.js';
import { Builds, buildxAvailable } from './builds.js';
import { Deployments } from './deployments.js';
import { Images } from './images.js';
import { Site } from './site.js';
import { Operations } from './operations.js';
import { initialAdminPassword, LocalUsers } from './local-users.js';
import { OperatorSessions } from './operator-sessions.js';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { DeploymentLabels } from './labels.js';
import { WebApp } from './web.js';
import { ApiTokens } from './api-tokens.js';
import { readEnvironment } from './environment.js';
import { ImageDistribution, packageRoute, readPackages } from './image-distribution.js';
import { imageHandler } from './distribution.js';

// Only what the manager needs before its web interface exists comes from the environment.
// Everything else is saved in the site settings and changed in the web interface.
const environment = readEnvironment();
const { dataDir, host, port, adminToken: token } = environment;
const store = new ReleaseStore(join(dataDir, 'releases'));
const imports = await Imports.open(store);
const web = await WebApp.open(environment.webDir);
const site = await Site.open(environment.siteDir, {},
  { keyFile: environment.siteKeyFile, buildsAvailable: await buildxAvailable() });
const deploymentServices = { store, images: new Images(environment.imagesDir),
  labels: await DeploymentLabels.open(join(dataDir, 'labels')) };
const localUsers = await LocalUsers.open(join(dataDir, 'auth'));
const apiTokens = await ApiTokens.open(join(dataDir, 'auth'));
if (!localUsers.list().length && (environment.bootstrapPasswordFile || !token)) {
  const password = environment.bootstrapPasswordFile
    ? (await readFile(environment.bootstrapPasswordFile, 'utf8')).replace(/\r?\n$/, '')
    : initialAdminPassword;
  await localUsers.create({ username: environment.bootstrapUsername, password, role: 'admin' });
}
const sessions = new OperatorSessions(localUsers);
const builder = new Builds(store);
const operations = new Operations(join(dataDir, 'operations'));
// The copies on the Nomad clients fetch images, and the image service itself, from this
// read-only listener. It serves nothing but verified images, so it listens on every interface.
const imagePackages = await readPackages();
// Drivers run only where Hub's image service can: on the architectures it is packaged for.
deploymentServices.imageArchitectures = imagePackages.map(pkg => pkg.arch);
const distribution = new ImageDistribution({ images: deploymentServices.images, site, packages: imagePackages,
  port: environment.distributionPort, address: environment.distributionAddress });
const imageListener = createServer(imageHandler(deploymentServices.images, { extra: packageRoute(imagePackages) }));
imageListener.listen(environment.distributionPort, '0.0.0.0', () =>
  console.log(`Driver Hub images for Nomad clients: port ${environment.distributionPort}`));
distribution.start();
const server = createApi(new Catalog(new GitHubReleases()), store, {
  get deployments() { return Deployments.forSite(site, deploymentServices); },
  distribution,
  get builds() { return site.state.manager.buildsEnabled && site.buildsAvailable ? builder : null; },
  get timings() { return site.state.manager.timings; },
  site, operations, token, apiTokens, sessions, localUsers, web, imports, images: deploymentServices.images,
  environment: environment.entries
});
server.listen(port, host, () => {
  const origin = `http://${host}:${server.address().port}`;
  console.log(`Driver Hub API: ${origin}/api/v1/releases`);
  console.log(web ? `Driver Hub web app: ${origin}/` : 'Driver Hub web app: not built (run npm run build in web/)');
});
