import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The settings the manager needs before its web interface exists, or that describe the machine
// it runs on. Everything else is saved in the site settings and changed in the web interface.
// Order is the order the web interface lists them in.
export function readEnvironment(env = process.env) {
  const value = name => env[name] === '' ? undefined : env[name];
  const dataDir = value('DRIVER_HUB_DATA_DIR') ?? join(homedir(), '.driver-hub');
  const siteDir = join(dataDir, 'site');
  const entries = [
    ['HOST', '127.0.0.1'],
    ['PORT', '8080'],
    ['DRIVER_HUB_DATA_DIR', dataDir],
    ['DRIVER_HUB_DISTRIBUTION_PORT', '5481'],
    ['DRIVER_HUB_DISTRIBUTION_ADDRESS', null],
    ['DRIVER_HUB_WEB_DIR', fileURLToPath(new URL('../web/build', import.meta.url))],
    ['DRIVER_HUB_SITE_KEY_FILE', join(siteDir, 'site.key')],
    ['DRIVER_HUB_BOOTSTRAP_USERNAME', 'admin'],
    ['DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE', null],
    ['DRIVER_HUB_ALLOW_PLAIN_HTTP', 'true'],
    ['DRIVER_HUB_ADMIN_TOKEN', null, true]
  ].map(([name, fallback, secret = false]) => {
    const set = value(name);
    return { name, secret, source: set !== undefined ? 'environment' : fallback === null ? 'unset' : 'default',
      value: secret ? null : set ?? fallback };
  });
  const effective = Object.fromEntries(entries.map(entry => [entry.name, entry.value]));
  return {
    // Shown to administrators; secrets only say whether they are set.
    entries,
    port: Number(effective.PORT),
    host: effective.HOST,
    dataDir,
    siteDir,
    imagesDir: join(dataDir, 'images'),
    distributionPort: Number(effective.DRIVER_HUB_DISTRIBUTION_PORT),
    // Unset, the address is detected from the manager's connection to Nomad.
    distributionAddress: value('DRIVER_HUB_DISTRIBUTION_ADDRESS'),
    webDir: effective.DRIVER_HUB_WEB_DIR,
    siteKeyFile: value('DRIVER_HUB_SITE_KEY_FILE'),
    bootstrapUsername: effective.DRIVER_HUB_BOOTSTRAP_USERNAME,
    bootstrapPasswordFile: value('DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE'),
    // Sign-in over plain HTTP from any host, the default while Hub is in development. Set it to
    // false behind HTTPS so the session cookie is Secure.
    plainHttp: effective.DRIVER_HUB_ALLOW_PLAIN_HTTP === 'true',
    adminToken: value('DRIVER_HUB_ADMIN_TOKEN')
  };
}
