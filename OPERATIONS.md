# Running Driver Hub

The manager is an HTTP API. Operators and the future UI use the same endpoints. The customer owns Nomad; device approval remains in VideoIPath.

## Installation

Run `npm ci --omit=dev` and `node src/main.js` on Node.js 22+, or build the container with `docker build -t driver-hub:local .`. The default listener for a native installation is loopback. For multi-user access, put the management listener behind HTTPS and provide `DRIVER_HUB_ADMIN_TOKEN` in the process environment. Send `Authorization: Bearer …` with each request. Non-loopback management requires this token. It grants administrative access; this release has no per-user role model.

| Setting | Where | Purpose |
| --- | --- | --- |
| `NOMAD_ADDR`, `NOMAD_NAMESPACE`, `NOMAD_DATACENTERS` | Manager | Nomad HTTP(S) API, namespace (`default`), comma-separated datacenters (`dc1`). Use a stable HTTPS endpoint in production. |
| `NOMAD_TOKEN` | Manager | Customer-provisioned Nomad ACL identity for listing, reading, planning and submitting service jobs and reading allocation checks. Use a namespace dedicated to Driver Hub. |
| `DRIVER_HUB_DATA_DIR` | Manager | Durable archive and release metadata; default `~/.driver-hub`. |
| `DRIVER_HUB_IMAGES_DIR` | Manager + image service | Filesystem for verified OCI content. Manager mounts read-write; serving replicas mount read-only. It must support atomic rename and survive loss of the management host. |
| `DRIVER_HUB_IMAGE_HOST` | Manager | Stable hostname and optional port (e.g. `driver-images.site.example`) of the **Driver Hub** pull service as reached by Nomad clients. No scheme or path. |
| `HOST`, `PORT` | Both processes | Bind address and port. Manager defaults to `127.0.0.1:8080` natively; image server defaults to `127.0.0.1:5000`. The container binds `0.0.0.0`. |
| `DRIVER_HUB_BUILDS` | Manager | `true` enables building reviewed source from the public repository using Docker Buildx. Off by default. |

**Image availability:** run `node src/serve-images.js` on a host independent of the manager. For host-redundant distribution run it on two independent hosts behind a stable HTTPS address, backed by resilient shared storage. Route `/v2/` and all `/v2/driverhub/…` requests to those processes; `/v2/` returns 200 when the listener is available. Use an actual manifest HEAD for a storage-aware health check. The service only supports pulls by digest, with no push or delete API. Restrict it to authorized client networks (or use mTLS at the proxy); ensure each client's container runtime trusts the endpoint. A second process or volume on the manager machine alone does **not** meet the HA requirement.

Example image-host container (provide `/srv/driverhub/images` from the shared filesystem):

```sh
docker run -d --name driverhub-images --restart unless-stopped \
  -p 127.0.0.1:5000:5000 \
  -v /srv/driverhub/images:/images:ro -e DRIVER_HUB_IMAGES_DIR=/images \
  driver-hub:local node src/serve-images.js
```

Both processes must have access to the published files; use the same service UID (the container uses UID 1000). Back up retained releases and the published image directory; use the customer's normal Nomad backup process for jobs and Variables. Do not delete a published digest needed by a running deployment or its rollback version.

## Deploy and migrate

The following paths are relative to `/api/v1`. JSON requests use `Content-Type: application/json`. A `2xx` submission means Nomad accepted desired state; it does not mean that the allocation is healthy. After a timeout, **read deployment state before retrying**.

| Operation | Request | Result |
| --- | --- | --- |
| Acquire | `PUT /retained/{driverId}/{version}` | Downloads immutable release metadata, settings declaration and archive. `GET /retained` lists local releases, including customer builds. |
| Stage | `POST /deployments` with `driverId`, `version`, `settings`, and optional `nodeId` | Validates configuration, verifies and publishes the image, then creates a persistent zero-instance job. Returns `nodeId`, digest-pinned `image`, `revision`, `evaluationId`. |
| List / inspect | `GET /deployments` or `GET /deployments/{nodeId}` | Lists managed jobs or returns the requested state, current settings and revision, prior version, allocations and communication evidence. |
| Find updates | `GET /updates` | Compares each deployment with discovered stable versions of the same driver. Shows newer versions by SemVer precedence; customer builds are never automatically treated as outdated. Suggestions do not download or deploy anything. |
| Start / cut over | `POST /deployments/{nodeId}/start` with `revision` | Sets desired count to one. For migration, first stop the original process, then include `originalStopped: true`. |
| Update | `POST /deployments/{nodeId}/update` with `revision`, `version`, optional replacement `settings` | Preflights the target before submission; preserves the device identity and saves the previous version **and settings**. Settings default to the existing set. |
| Roll back | `POST /deployments/{nodeId}/rollback` with `revision` | Switches to the preceding saved version/settings. Does not undo physical device configuration changes. |
| Stop | `POST /deployments/{nodeId}/stop` with `revision` | Sets count to zero without needing the image store. Keeps deployment state. For migration back to an external host, verify that the allocation has actually stopped before restarting the original. |

Example stage body using the proposed meter configuration:

```json
{
  "driverId": "exampleco-meter",
  "version": "1.4.0",
  "settings": {
    "deviceHost": "meter-01.site.example",
    "deviceCredential": {"secretRef": "device_token"}
  }
}
```

For a new device omit `nodeId`; Hub generates one. For an existing device supply its lowercase UUID. Hub uses one service job named `driverhub-<nodeId>` and passes `VIDEOIPATH_NODE_ID` to the container. For a driver that reads another env or file binding, set `"nodeIdInput":"nameOfInput"` at the top of the configuration declaration. Hub fills that non-secret string input with the same UUID and rejects conflicting operator values. Approve newly discovered devices in VideoIPath.

**Settings delivery:** env bindings use a rendered Nomad env file; file bindings render allocation-scoped files and mount them read-only at the declared container paths. For each secret, provision its key in the customer’s Nomad Variable `nomad/jobs/driverhub-<nodeId>` in the same namespace. Use identifier-style keys such as `device_token`, starting with a letter or underscore. Workload identities read their job-scoped variable; Hub never needs the actual values. The staging response provides the UUID needed to provision variables before starting a new device.

Every change after staging requires the `revision` returned by the prior submission or current GET. Competing writers get `409` on stale state. Staging with the same UUID cannot take over another job. Multiple devices reuse the same image independently; there is no need to upload a separate package for each.

## Monitoring and failover

Linux Nomad clients need a healthy Docker task driver and access to VideoIPath, the device, Nomad Variables and the image service. Jobs constrain placement to a supported architecture. Resources currently default to 500 MHz CPU and 256 MiB per task; qualify driver-specific requirements before production use.

An optional declaration extension, `"controlHealth":{"port":8080,"path":"/control"}`, tells Hub to register an HTTP check with Nomad service discovery. Use it **only** for a driver endpoint that returns success when both its VideoIPath session and device communication are working. The driver must listen on the declared container port. Hub returns `driver-reports-connected` only for a recent successful check on the current running allocation, `check-failed` for a recent failure, and `unknown` without fresh evidence. Approval is always `unknown` in this API. Container liveness alone is not a control check.

Nomad's service scheduler restarts or reschedules the job without Hub intervention. Updates have no canaries. The job uses [`disconnect.stop_on_client_after`](https://developer.hashicorp.com/nomad/docs/job-specification/disconnect) (30 seconds) to have a disconnected client stop its task. This is **not hard fencing**: it depends on the Nomad agent still running and on synchronized clocks. If a driver survives a frozen agent or a management partition, two instances may compete for the same VideoIPath session. For sites requiring a strict single-writer guarantee, commission host or network fencing before enabling automatic takeover; a successful clean host-loss test does not prove partition safety.

## Customer builds

Enable `DRIVER_HUB_BUILDS=true` on a manager with a Docker CLI, an OCI-export-capable Buildx builder and access to the public repository. For the containerized manager build the optional `builder` target (`docker build --target builder -t driver-hub:builder .`) and connect it to a dedicated build daemon. A source build executes the selected Dockerfile; use a builder appropriate for the code's trust level. No push credentials are needed. Configure an HTTP timeout long enough for builds (up to 30 minutes).

`POST /api/v1/builds` with `driverId`, full Git `commit`, `directory` under `Drivers/` or `examples/`, and optionally `platform` (`linux/amd64` or `linux/arm64`). Hub uses `driver-config.json` at that same revision unless the admin provides the `configuration` declaration in the request. The driver directory must contain a self-contained Dockerfile/context. Buildx receives a pinned Git context and exports OCI locally. A successful build returns a retained release with `origin: "customer"` and a unique `0.0.0-local.…` version. It is deployable through the same API; nothing is published to GitHub or a public registry.

For a commissioning exercise before the first upstream packaged release exists, this is a build request for the [upstream Rust demonstration driver](https://github.com/VideoIPath/VideoIPath_External_Drivers/tree/f64a319caf5f27fd46ef2ce203c71e6aa63f3d4c/examples/rust_example). This revision was built and its OCI image verified during backend development. The example models an in-memory device, not physical equipment.

```json
{
  "driverId": "rust-example",
  "commit": "f64a319caf5f27fd46ef2ce203c71e6aa63f3d4c",
  "directory": "examples/rust_example",
  "configuration": {
    "schemaVersion": 1,
    "inputs": [
      {"name":"backendUrl","type":"string","required":true,"env":"VIDEOIPATH_URL"},
      {"name":"backendToken","type":"string","required":true,"secret":true,"env":"VIDEOIPATH_TOKEN"}
    ]
  }
}
```

Use the returned local version in the stage request. Set `backendUrl` to the test VideoIPath external driver WebSocket URL and pass a secret reference for `backendToken`. Stage first, provision the job-scoped Variable, then start. The example uses its default trust roots; a site-specific CA requires the driver's documented CA configuration. No control-health endpoint is declared here, so check application-level communication in VideoIPath.

## Verification

`npm test` runs API, integrity, concurrent retention and lifecycle tests. Set `DRIVER_HUB_TEST_DOCKER=1` to also build an OCI image and pull it into a fresh client from the independent distribution container. Set `DRIVER_HUB_TEST_NOMAD` to a local Nomad executable to also start a disposable, loopback-only server, register a staged job and verify revision enforcement. These tests require no customer cluster or VideoIPath credentials.

**Site acceptance:** use a test device and two eligible Nomad clients. Stage and start one approved driver, verify a real control read, update it and roll back with the same UUID. With the manager host powered off, fail the active driver host and verify that the cold client pulls the exact digest, reads its configuration and restores actual device communication. Record recovery time. Separately partition the old host's management network while its device network remains reachable and test site fencing. Only then claim the site meets its HA target.
