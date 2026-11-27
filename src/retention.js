import { expect } from './errors.js';
import { InvalidRelease } from './release.js';
import { imageKey } from './images.js';

// Removes a retained release and its verified image, unless a deployment in the configured Nomad
// namespace runs it or keeps it to roll back to. Deployments left on a previously configured
// cluster or namespace are not visible here, so keep the releases they use.
export async function removeRelease({ store, images, deployments }, driverId, version) {
  let release;
  try {
    release = await store.load(driverId, version);
    expect(release, 'Unknown retained release', 404);
  } catch (error) {
    // A damaged release can still be removed; only its image cannot be identified.
    if (!(error instanceof InvalidRelease)) throw error;
  }
  const configured = Boolean(deployments?.nomad.address);
  if (!configured) {
    const journal = deployments?.site?.journal;
    expect(release && images && journal &&
      ![...journal.records.values()].some(r => r.refs.includes(`${driverId}/${version}`)) &&
      !await images.info(imageKey(release.record)),
    'Configure Nomad to check usage of a published or previously staged release', 409, 'deployment_unknown');
  }
  const uses = configured ? await deployments.usage(driverId, version) : [];
  expect(!uses.length, 'Deployments run this release or keep it for rollback', 409, 'release_in_use',
    { deployments: uses });
  const image = release && images && await images.remove(release.record) ? 'removed' : 'none';
  expect(await store.remove(driverId, version), 'Unknown retained release', 404);
  return { driverId, version, removed: true, image };
}
