import { Catalog } from './catalog.js';
import { GitHubReleases } from './github.js';
import { createApi } from './http.js';

const port = Number(process.env.PORT ?? 8080);
const server = createApi(new Catalog(new GitHubReleases()));
server.listen(port, '127.0.0.1', () => {
  console.log(`Driver Hub API: http://127.0.0.1:${server.address().port}/api/v1/releases`);
});
