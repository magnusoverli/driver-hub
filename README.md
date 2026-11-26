# Driver Hub

Driver Hub is a self-hosted application for customer operators and administrators to browse, download, deploy, monitor and update VideoIPath external drivers. It integrates with the [public driver repository](https://github.com/VideoIPath/VideoIPath_External_Drivers) for releases and with a customer-operated Nomad cluster for execution. This project is independent of the upstream repository.

**Project state:** The backend implements release discovery, retention, customer source builds, verified OCI image distribution, and per-device deployment, migration, monitoring, updates and rollback via Nomad. See [installation and operation](OPERATIONS.md) for the lifecycle API and HA acceptance procedure. Site commissioning against VideoIPath and a physical device is still required. The upstream release convention remains a proposal.

**Frontend handoff:** start with the [client API contract](OPERATIONS.md#client-api-contract). The running manager serves OpenAPI at `/api/v1/openapi.json`, exposes access and integration capabilities, supports scheduler dry runs, and tracks asynchronous build/download requests across browser disconnects.

## Running the backend

Install Node.js 22 or newer and run `npm ci`, then `npm start`. The management HTTP API listens on `127.0.0.1:8080`; set `PORT` to change the port. Run `npm test` for the automated tests. Opt-in real Docker and Nomad tests are described in [OPERATIONS.md](OPERATIONS.md#verification).

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/releases` | Lists published release candidates from the public repository in GitHub's order. Requires a per-driver SemVer tag and an uploaded `driver-release.json`. Prereleases are hidden unless `?prerelease=true`. An empty list is expected until maintainers publish matching releases. |
| `GET /api/v1/releases/{driverId}/{version}` | Returns `record` and `configuration` after checking tag identity, required asset presence, configuration SHA-256 and supported input declarations. Does not download or verify image bytes. |
| `POST /api/v1/releases/{driverId}/{version}/validate` | Accepts an `application/json` settings object. Returns `{ "valid": true, "errors": [] }` or field names and error codes. Checks required inputs, non-secret defaults, string length, integer bounds, booleans and secret-reference shape. Does not resolve credentials, persist values, or submit a job. |
| `PUT /api/v1/retained/{driverId}/{version}` | Downloads a selected release from GitHub. Streams up to 2 GiB of compressed archive data, checks the archive SHA-256, and publishes the archive, record and declaration together. Repeating this request checks upstream metadata and reuses an identical retained version; a changed record returns 409 without overwriting it. |
| `GET /api/v1/retained/{driverId}/{version}` | Returns saved metadata and configuration without contacting GitHub. Returns 404 when that version has not been retained. |
| `POST /api/v1/retained/{driverId}/{version}/validate` | Validates settings against the saved declaration instead of fetching from GitHub. Uses the same request and response as upstream validation. |

For the proposed sample declaration, a settings body would be `{"deviceHost":"meter.local","deviceCredential":{"secretRef":"device_token"}}`. Omitted settings with a declared default pass validation. Deployment resolves secret references from job-scoped Nomad Variables. A 404 means the release was not found, 422 indicates unusable metadata or settings, and 502 means an upstream request failed (including GitHub rate limits).

Set `DRIVER_HUB_DATA_DIR` to select the retention directory (default: `.driver-hub` in the user's home). Retention verifies the archive checksum and commits a version by directory rename. Before job submission, `src/images.js` validates the OCI layout, manifest/index digest, referenced descriptors, blob sizes, checksums and declared platforms. The separate pull-only distribution process serves verified content from `DRIVER_HUB_IMAGES_DIR` and needs neither the manager nor GitHub.

`src/catalog.js` coordinates discovery and retention. `src/builds.js` produces site-local releases. `src/deployments.js` orchestrates lifecycle operations; `src/job.js` translates a validated deployment to a job, and `src/nomad.js` implements the cluster API. Job definitions and revision checks live in Nomad so recovery does not depend on a running management API.

## Application definitions

| Term | Meaning in Driver Hub |
| --- | --- |
| Driver | Software that connects VideoIPath to a device through the external driver API. Its catalog identity identifies the software, not a particular device. |
| Release | A maintainer-published version of one driver, distributed as a ready-to-run OCI image. A version is meaningful within that driver; the image digest identifies the exact content to run. |
| Customer build | A deployable image built from source for one customer's use. Keep its source revision and image digest distinct from maintainer releases, even when built from the same tag. |
| Deployment | The persistent association between a physical device, its stable VideoIPath `node_id`, its customer configuration and the selected driver image. It survives process replacement. |
| Running instance | The process Nomad runs for a deployment. One active instance per device is the goal; a replacement uses the existing deployment identity. |
| Recovery | Communication between VideoIPath and the device through its driver has returned. A running container alone does not establish recovery. |

## Decision record

| Interview item | Decision and consequence |
| --- | --- |
| 1. Deployment unit | Download a release once and reuse it across devices. Each physical device gets an independently configured instance; updating one need not interrupt the others. |
| 2. Availability | Recover control automatically after a process or host failure. Driver loss interrupts device control and may leave monitoring or alarms stale. Media that the device continues processing with its last configuration is outside the driver recovery path. No recovery-time target has been agreed. |
| 3. Nomad boundary | Customer operates the cluster and provides a stable API address. Driver Hub submits and updates jobs and observes their status. Nomad schedules and recovers workloads without requiring Driver Hub to be online for each restart. |
| 4. Ownership | The project repository is private: [magnusoverli/driver-hub](https://github.com/magnusoverli/driver-hub). It is not a fork or an official component of the upstream project. |
| 5–7. Distribution | Prefer versioned, maintainer-published OCI images. Also support downloading source and building in a connected Driver Hub environment. Customer admins may test or run their own builds, including in production; these actions never publish upstream. |
| 8–10. Connectivity and distribution (revised) | Assume the running Driver Hub has internet access for release discovery and download. The earlier requirement to support a disconnected installation is superseded. Driver Hub owns image distribution to eligible Nomad clients; no integration with customer-private registries. |
| 11. Release discovery | Discover updates per driver, independently of unrelated changes in the public repository. Propose a machine-readable per-driver release convention to upstream maintainers. Its adoption is pending. |
| 12. Approval | Device approval stays in VideoIPath. Distinguish Nomad process status from driver communication; report only states that can be verified. |
| 13. Migration | Support moving an already-running external driver to Driver Hub in the first release. Preserve the existing `node_id`. Stage the replacement, stop the original, start the replacement, then verify control. To revert, stop the replacement before restarting the original. |
| 14. Configuration | Each deployable release declares its inputs: names, types, requirements, defaults where applicable, secret fields and how the image receives them. Customer values stay local. Validate against the target release before deployment or cutover. |

UI implementation belongs to a separate developer. The lifecycle and status meanings above are shared product behavior; screen design and frontend technology are outside this discussion.

**HA acceptance criterion:** With the Driver Hub management host unavailable, fail the host running a driver. Given a functioning Nomad cluster and an eligible replacement client with no cached image, Nomad must be able to start the pinned image with the existing configuration, credentials and `node_id`, and restore device communication. Recovery must not depend on the management host returning. The connectivity assumption applies to the running Hub; it does not require every Nomad client to have internet access.

## Upstream proposal (items 11 and 14)

The maintainer-facing draft is deliberately kept outside this repository: `VideoIPath-Driver-Release-Proposal.md` on the project owner's Desktop. It proposes a per-driver Git tag and GitHub Release with three offline-transferable assets: `driver-release.json`, `driver-config.json`, and an OCI image archive. Consumers would verify the referenced digests before deployment. Source-only contributions would remain valid. These filenames and formats are proposals, not a prerequisite the public repository already satisfies.

## Resume here

The first unresolved design question is **safe failover during a network partition**. Under the documented external driver protocol, a second connection with the same `node_id` takes over the session. If a Nomad client loses contact with its servers but its driver can still reach VideoIPath, the original and replacement could repeatedly displace each other. A desired instance count of one does not settle that case. See the upstream [protocol walkthrough](https://github.com/VideoIPath/VideoIPath_External_Drivers/blob/main/examples/rust_example/docs/PROTOCOL.md).

| Open design item | What to establish |
| --- | --- |
| Failover and health | How to prevent competing instances, what evidence confirms device communication, and how quickly control needs to return. Verify takeover and recovery with the intended VideoIPath release. |
| Image distribution | Commission the independent distribution replicas and storage; verify a pull by a cold replacement client with the management host powered off. |
| Release pilot | Whether upstream maintainers accept the convention. Exercise discovery and download of two releases of one driver, a changed required setting, update and rollback. |

When resuming work, read this file first. Preserve the interview numbers when revising a decision, distinguish proposals from agreements, and add subsequent decisions with the next available number.
