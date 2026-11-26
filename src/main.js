import { Catalog } from './catalog.js';
import { GitHubReleases } from './github.js';
import { createApi } from './http.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ReleaseStore } from './release-store.js';

const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.DRIVER_HUB_DATA_DIR ?? join(homedir(), '.driver-hub');
const server = createApi(new Catalog(new GitHubReleases()), new ReleaseStore(join(dataDir, 'releases')));
server.listen(port, '127.0.0.1', () => {
  console.log(`Driver Hub API: http://127.0.0.1:${server.address().port}/api/v1/releases`);
});
