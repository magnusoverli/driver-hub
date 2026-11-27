# Running Driver Hub

The manager is an HTTP API. Operators and the future UI use the same endpoints. The customer owns Nomad; device approval remains in VideoIPath.

## Installation

Run `npm ci --omit=dev` and `node src/main.js` on Node.js 22+, or build the container with `docker build -t driver-hub:local .`. A native installation listens on loopback by default. The manager requires authentication even on loopback. The manager also serves the web frontend from `web/build` (the container image includes it), so the browser loads the app and `/api/v1` from one origin. For remote browser access, put that listener behind HTTPS, preserve the public `Host` header at the reverse proxy, and use a local operator account. Plain HTTP works only at `http://localhost`, because the session cookie is `Secure`. Existing admin and viewer bearer tokens remain supported for automation.

| Setting | Where | Purpose |
| --- | --- | --- |
| `NOMAD_ADDR`, `NOMAD_NAMESPACE`, `NOMAD_DATACENTERS` | Manager | Nomad HTTP(S) API, namespace (`default`), comma-separated datacenters (`dc1`). Use a stable HTTPS endpoint in production. |
| `NOMAD_TOKEN` | Manager | Customer-provisioned Nomad ACL identity for listing, reading, planning and submitting service jobs and reading allocation checks. Use a namespace dedicated to Driver Hub. |
| `DRIVER_HUB_NOMAD_SHARED_WRITERS` | Manager | Set to `true` if another process can edit Hub jobs directly. Disables job purge, which has no server-side revision check. |
| `DRIVER_HUB_NOMAD_UI_ORIGIN` | Manager | Optional operator-facing HTTPS origin of the target Nomad UI. Adds allocation log links using the operator’s own Nomad login; leave unset if targets do not share that UI. |
| `DRIVER_HUB_NOMAD_TIMINGS` | Manager | Set to `true` to return `Server-Timing` with API duration and upstream call, decoded response byte and error counts. Shared reads are counted on the request doing the work. |
| `DRIVER_HUB_DATA_DIR` | Manager | Durable archive and release metadata; default `~/.driver-hub`. |
| `DRIVER_HUB_IMAGES_DIR` | Manager + image service | Filesystem for verified OCI content. Manager mounts read-write; serving replicas mount read-only. It must support atomic rename and survive loss of the management host. |
| `DRIVER_HUB_IMAGE_HOST` | Manager | Stable hostname and optional port (e.g. `driver-images.site.example`) of the **Driver Hub** pull service as reached by Nomad clients. No scheme or path. |
| `HOST`, `PORT` | Both processes | Bind address and port. Manager defaults to `127.0.0.1:8080` natively; image server defaults to `127.0.0.1:5000`. The container binds `0.0.0.0`. |
| `DRIVER_HUB_BUILDS` | Manager | `true` enables building reviewed source from the public repository using Docker Buildx. Off by default. |
| `DRIVER_HUB_WEB_DIR` | Manager | Built frontend to serve; default `web/build` beside `src/`. Without an `index.html` there, the manager serves only the API. |

**Image availability:** run `node src/serve-images.js` on a host independent of the manager. For host-redundant distribution run it on two independent hosts behind a stable HTTPS address, backed by resilient shared storage. Route `/v2/` and all `/v2/driverhub/…` requests to those processes; `/v2/` returns 200 when the listener is available. Use an actual manifest HEAD for a storage-aware health check. The service only supports pulls by digest, with no push or delete API. Restrict it to authorized client networks (or use mTLS at the proxy); ensure each client's container runtime trusts the endpoint. A second process or volume on the manager machine alone does **not** meet the HA requirement.

Example image-host container (provide `/srv/driverhub/images` from the shared filesystem):

```sh
docker run -d --name driverhub-images --restart unless-stopped \
  -p 127.0.0.1:5000:5000 \
  -v /srv/driverhub/images:/images:ro -e DRIVER_HUB_IMAGES_DIR=/images \
  driver-hub:local node src/serve-images.js
```

Both processes must have access to the published files; use the same service UID (the container uses UID 1000). Back up retained releases, the published image directory and `DRIVER_HUB_DATA_DIR/labels` (operator-entered device names); use the customer's normal Nomad backup process for jobs and Variables. Do not delete a published digest needed by a running deployment or its rollback version.

## Operator sign-in

**First administrator:** on the first start, set `DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE` to a protected UTF-8 file containing the initial password (one trailing line ending is ignored). In Docker, mount it read-only, readable by UID 1000. The initial username is `admin`, or set `DRIVER_HUB_BOOTSTRAP_USERNAME`. Remove the bootstrap mount and setting after provisioning. Restarting with an existing account store never resets a password. Alternatively, an installation with `DRIVER_HUB_ADMIN_TOKEN` can create its first admin via `POST /api/v1/users` using the bearer token. There is no public sign-up or default password.

**Frontend:** all paths below are relative to `/api/v1`. On page load, call `GET /auth/session`; a 401 means show the login form. Send `Content-Type: application/json` with JSON bodies and **`X-Driver-Hub-Request: 1` on login, logout, and every non-GET cookie-authenticated request**, including deploy-form previews. Use same-origin fetch so the browser handles the `HttpOnly; Secure; SameSite=Strict` cookie. Do not enable cross-origin credentialed access at a proxy. A bearer header selects service authentication on management routes; omit it when acting as a signed-in user.

| API | Behavior |
| --- | --- |
| `POST /auth/login` | `{ "username": "...", "password": "..." }`. Sets an 8-hour session cookie and returns `{username, role, provider}`. Bad credentials and disabled accounts return the same 401. Repeated failures or too many concurrent verifications return 429. |
| `GET /auth/session` | Returns the current operator; use `role` (`admin` or `viewer`) to choose which controls to display. The API also enforces permissions. |
| `POST /auth/logout` | Revokes the current session and clears the cookie. Restarting the manager signs everyone out. |
| `POST /auth/password` | A local user supplies `currentPassword` and `newPassword`. Success invalidates all their sessions; sign in again. |
| `GET /users`, `POST /users` | Admin only. List local accounts or create one with `username`, `password`, and `role`. Usernames are case-insensitive; passwords require at least 12 characters (up to 1024 UTF-8 bytes). |
| `PATCH /users/{username}` | Admin only. Supply `role`, `enabled`, and/or a replacement `password`. Changes invalidate the user's sessions. The last enabled local admin cannot be disabled or demoted. |
| `DELETE /users/{username}` | Admin only. Deletes a local account and ends its sessions. Refuses the last enabled admin (`409 last_admin`) and the signed-in operator's own account (`409 own_account`). Recreating the username starts a new account; sessions of the deleted one never become valid again. |

**Persistence and recovery:** back up `DRIVER_HUB_DATA_DIR/auth` with the manager data and restrict access to it. The account store contains salted scrypt hashes and roles. Use one manager per directory. A second admin (or an operator with host access who configures the admin service token and restarts the manager) can reset a forgotten password. Operator sessions are held in memory; signing out does not affect any running driver.

**Future LDAP:** sessions use an identity provider with `authenticate(username, password)` and `resolve(username)`. The provider returns a username, provider identifier, Hub role and authorization revision. Disabled users or changed roles/revisions lose access on the next request. An LDAP provider can map directory groups to Hub roles behind this interface; the browser contract stays the same. Only the local provider is implemented today.

## Site setup after container startup

Start the manager with a durable directory writable by UID 1000 and the address of the separate image service. Example using a bootstrap password file (expose the loopback port through your HTTPS gateway):

```sh
docker run -d --name driverhub --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v /srv/driverhub/bootstrap-password:/run/secrets/initial-password:ro \
  -e DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE=/run/secrets/initial-password \
  -v /srv/driverhub/data:/data -e DRIVER_HUB_DATA_DIR=/data \
  -v /srv/driverhub/images:/images -e DRIVER_HUB_IMAGES_DIR=/images \
  -e DRIVER_HUB_IMAGE_HOST=driver-images.site.example driver-hub:local
```

Use these admin-only JSON endpoints under `/api/v1`. Supply the latest `revision` on each PUT. Tokens are write-only.

| Request | Input and result |
| --- | --- |
| `GET /site` | Returns revision, addresses, namespace, datacenters, token availability and per-device assignments (UUID and SHA-256 token fingerprint). No credential values. |
| `PUT /site/nomad` | `{"revision":0,"address":"nomad.site.example","namespace":"default","datacenters":["dc1"],"token":"<Nomad ACL token>"}`. A bare IP or DNS name uses HTTPS on 4646; an explicit API URL can specify another port. Hub checks the leader and job-list access before saving. Omit the token to keep it on the same target, or send `null` for an ACL-disabled cluster. |
| `PUT /site/videoipath` | `{"revision":1,"address":"vip.site.example","tokens":["<driver token A>","<driver token B>"]}`. Hub normalizes the address to `wss://vip.site.example/x-driver/v1`. The default `tokenMode` is `per-device`. Repeat with the current revision to add more pre-issued tokens. Saving does not open a driver session. |
| `DELETE /site/videoipath/tokens/{fingerprint}?revision=N` | Removes a per-device token from the pool, identified by the SHA-256 fingerprint that `GET /site` lists under `videoipath.pool`. Allowed for an unused token, or one reserved for a device whose deployment no longer exists; a token of an existing deployment returns `409 token_in_use`. Revoke removed tokens in VideoIPath. |

**Token ownership:** Create external-driver bearer tokens in the VideoIPath CLI. Hub reserves one distinct token per device UUID when actually staging. A preview consumes none. An empty pool returns `409 driver_token_pool_empty`; it never falls back to sharing. Retrying a failed stage with the same UUID reuses its reservation. Rescheduling, restarting, updating and rolling back an existing device do not claim another token. To deliberately share one token among future deployments, set `"tokenMode":"shared"` and supply `"token"` instead of `"tokens"`. Revocation remains in VideoIPath. Match the admin-visible fingerprint to your issuance record; the logged fingerprint should be computed on the exact token bytes without a newline.

**Stage:** Send a client-generated lowercase UUID in `Idempotency-Key` for new site-managed devices (the existing `nodeId` for migration). Omit VideoIPath connection settings. The driver receives `VIDEOIPATH_URL`, `VIDEOIPATH_TOKEN` and `VIDEOIPATH_NODE_ID`; the driver must support those bindings and establish the WebSocket itself. For different env/file bindings, a release can declare `"videoIPathInputs":{"url":"backendUrl","token":"backendToken"}` referencing a public string and a secret string input. Set `"inheritSite":false` at staging to use manual release settings. Existing jobs keep their saved target; changing sites does not migrate or stop them. Selecting a different configured Nomad address/namespace clears the VideoIPath defaults for future jobs.

**Storage and access:** Give the manager read/write access to the task Variables at `nomad/jobs/driverhub-<uuid>/device/driver` in its namespace, in addition to its existing job rights. To let it remove that Variable when a deployment is deleted, also grant `destroy` on the same path; without it the deletion succeeds and reports the Variable as left behind. The job contains a reference; the allocation reads its token from Nomad independently of the manager. Use HTTPS to remote Nomad when delivering credentials. For a private CA, configure the manager's Node trust store (e.g. `NODE_EXTRA_CA_CERTS`); separately configure trust in driver images for VideoIPath.

Example [Nomad ACL policy](https://developer.hashicorp.com/nomad/docs/other-specifications/acl-policy) (replace the namespace with the actual site namespace):

```hcl
namespace "driver-hub" {
  capabilities = ["list-jobs", "read-job", "submit-job"]
  variables {
    path "nomad/jobs/driverhub-*/device/driver" {
      capabilities = ["read", "write", "destroy"]
    }
  }
}
```

Omit the Variables stanza for manual registration. The manager does not need `read-logs`, filesystem access, exec or node administration. Use an HTTPS gateway with client authentication if the site requires mTLS; Hub does not load per-target client certificates. A Nomad connection test exercises leader and list access, not job submission, Variable rights, or the Docker daemon’s path to the registry.

One manager process owns a data directory. Settings, including reservations, are persisted under `DRIVER_HUB_DATA_DIR/site` with AES-256-GCM. By default the key is created alongside the ciphertext: anyone with access to both can decrypt it. To separate the key, mount a file containing exactly 32 random bytes and set `DRIVER_HUB_SITE_KEY_FILE` **before first setup**. Protect and back up the state and corresponding key; losing assignments can lead to token reuse. Persisted settings take precedence over `NOMAD_*` startup defaults.

## Deploy and migrate

The following paths are relative to `/api/v1`. JSON requests use `Content-Type: application/json`. A `2xx` submission means Nomad accepted desired state; it does not mean that the allocation is healthy. After a timeout, **read deployment state before retrying**.

| Operation | Request | Result |
| --- | --- | --- |
| Acquire | `PUT /retained/{driverId}/{version}` | Downloads immutable release metadata, settings declaration and archive. `GET /retained` lists local releases, including customer builds. |
| Remove a release | `DELETE /retained/{driverId}/{version}` | Admin only. Checks current and rollback references. `409 release_in_use` lists `details.deployments` with `use: current`, `previous`, or `unconfirmed` (unfinished write or another target). Without Nomad, only an unpublished release with no journal references can be removed. |
| Stage | `POST /deployments` with `driverId`, `version`, `settings`, and optional `nodeId` | Validates configuration, verifies and publishes the image, then creates a persistent zero-instance job. Returns `nodeId`, digest-pinned `image`, `revision`, `evaluationId`. |
| List / inspect | `GET /deployments` or `GET /deployments/{nodeId}` | The list returns one summary per managed device: label, driver and version, Nomad job status, revision, requested state, communication evidence and the newest allocation Nomad wants running. A device Nomad cannot report at that moment stays listed with `requested: null` and evidence reason `status_unavailable`. The detail adds current settings, pinned image, prior version, all allocations and `inheritsSite` (whether the device takes its VideoIPath target and token from the site, as saved at staging; render update forms with the same choice). |
| Name a device | `PUT /deployments/{nodeId}/label` with `{"label":"Studio 3 meter"}` or `{"label":null}` | Admin only. 1–80 characters, trimmed, no control characters. Labels are stored by the manager, not in the Nomad job, so renaming never changes or restarts a driver. A stage request may include the same optional `label`. |
| Find updates | `GET /updates` | Compares each deployment with discovered stable versions of the same driver. Shows newer versions by SemVer precedence; customer builds are never automatically treated as outdated. Suggestions do not download or deploy anything. |
| Start / cut over | `POST /deployments/{nodeId}/start` with `revision` | Sets desired count to one. For migration, first stop the original process, then include `originalStopped: true`. |
| Update | `POST /deployments/{nodeId}/update` with `revision`, `version`, optional replacement `settings` | Preflights the target before submission; preserves the device identity and saves the previous version **and settings**. Settings default to the existing set. |
| Roll back | `POST /deployments/{nodeId}/rollback` with `revision` | Switches to the preceding saved version/settings. Does not undo physical device configuration changes. |
| Stop | `POST /deployments/{nodeId}/stop` with `revision` | Sets count to zero without needing the image store. Keeps deployment state. For migration back to an external host, verify that the allocation has actually stopped before restarting the original. |
| Delete | `DELETE /deployments/{nodeId}?revision=N` | Admin only, for a stopped deployment with no nonterminal or `lost` allocations. Purges the job/history and label. Cleanup removes only the registration key whose write Hub recorded, with a Variable CAS check; other keys and the device's own secrets path are preserved. The reserved VideoIPath token stays in its pool. Cannot be undone. |

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

Every lifecycle change after staging requires the reviewed job revision. Hub serializes lifecycle, release deletion and site writes within one manager, and registers jobs against Nomad’s `JobModifyIndex`. Nomad **does not** offer a conditional purge: grant exclusive job-write access to Hub or disable purge. Updates and rollbacks normalize an externally stopped job to persistent count zero; only an explicit start resumes it. Legacy jobs without an owner marker require a dedicated namespace. Do not manually edit Hub-rendered jobspecs; the next Hub registration reconstructs them.

Back up `site/deployments/` with site state. It holds the installation identity, per-target release pins and incomplete cleanup receipts. Switching targets checks the departing namespace before saving. To retire jobs on a previous target, reconnect to it and complete removal there. An unreachable prior target is not proof that its releases are unused. For `nomad_write_unconfirmed`, inspect the stable job ID and revision before retrying; repeat a new-device stage with its original idempotency key. A registration key already present before staging is borrowed, not deleted. For `registrationVariable: failed`, inspect the named task Variable and reconcile **only the old key** (or restore permissions); retry DELETE with the same revision. A legacy or changed Variable is deliberately not treated as owned. Pending deletion prevents that UUID from being restaged.

## Client API contract

### Render and validate the deployment form

`POST /api/v1/retained/{driverId}/{version}/deploy-form` returns the form for a locally retained release. Use the identical `/api/v1/releases/{driverId}/{version}/deploy-form` route to inspect a published release before retaining it. Both accept viewers. Send JSON `{}` for the initial form; resend with the current `settings` object to validate edits. For example:

```json
{"inheritSite":true,"settings":{"deviceHost":"meter.local","deviceCredential":{"secretRef":"device_key"}}}
```

`inheritsSite` reports the effective choice. Omitting `inheritSite` follows staging's default (inherit if configured); `true` requires a configured site (otherwise 409); `false` uses manual release settings. Optional `nodeId` is the existing or planned deployment UUID for checking identity-bound fields; normally omit identity fields from `settings`.

| `fields[].source` | Frontend behavior |
| --- | --- |
| `operator` | Render the declared type, required flag, optional default and limits (`minimum`, `maximum`, `minLength`). For `secret:true`, collect a **reference name** matching `secretRefPattern` and submit `{"secretRef":"name"}`. A required field with a default may be omitted. |
| `site` | Show as supplied by the site. Omit from `settings`, including URL and token bindings with custom names. |
| `identity` | Show as supplied by Hub, including for migrations that use a top-level `nodeId`. Omit from `settings`. |

HTTP 200 returns `validation: {"valid":boolean,"errors":[{"field":"…","code":"…"}]}` even for an incomplete form. Join error `field` to field `name`. The response contains declaration metadata, not entered values or resolved secrets. The calculation checks deployment inputs only; it neither checks token availability nor plans placement. Follow it with the deployment dry run when ready. The older `/validate` endpoints still check the raw release declaration without site or identity inheritance.

### Client discovery and lifecycle requests

`GET /api/v1/openapi.json` serves the OpenAPI 3.1 contract, including request and response schemas for all management routes. For offline client generation, export the same contract from the repository with `node --input-type=module -e "import {apiContract} from './src/openapi.js'; console.log(JSON.stringify(apiContract))"`. The manager's `GET /api/v1/capabilities` identifies the caller's access level and which integrations are configured; it does not claim the cluster can schedule a driver.

| Client task | Backend behavior |
| --- | --- |
| Check Nomad connectivity | `GET /api/v1/integrations/nomad` distinguishes unconfigured, no leader and connected. Connected means the manager found a leader and could list jobs in its namespace. An upstream error returns 502; it is not an empty cluster. |
| Preview a change | Add `?dryRun=true` to the existing stage, start, update, rollback or stop POST, with the same body/revision. Hub validates settings and asks Nomad for a plan, without publishing an image or registering a job. The response includes requested count as `running`/`stopped`, pinned image, current revision, `schedulable` and placement failures. Staging plans zero instances; use a **start** preview to check placement. A preview never reserves capacity or a new UUID. |
| Apply after preview | Repeat the POST without `dryRun`, using the original revision. Migration start still needs `originalStopped: true`. A 409 with `code: "revision_conflict"` means to reload and review, not to overwrite. |
| Retry a new-device stage | Before the first POST, generate a random lowercase UUID and send it in `Idempotency-Key`, omitting `nodeId`. That UUID becomes the new device's stable identity. Retrying identical input returns `replayed: true` with the **current** revision/image; it never reverts later updates. Different input under the same key conflicts. For migrations send the existing `nodeId` alone and inspect it after a timeout. |
| Diagnose a deployment | Detail includes `requiresOriginalStopped`, pinned image, allocation/task state, restart counts when available, and `communicationEvidence`. `GET /api/v1/deployments/{nodeId}/evaluations` returns the latest 50 scheduler evaluations, newest first, with placement failure counts. A completed evaluation alone is not proof of control. |
| Inspect a rollout | `GET /api/v1/deployments/{nodeId}/rollout` returns the latest rollout only if its job version and namespace match the current job; otherwise `rollout` is `null`. Allocation rows can show the latest task-event type without returning log text. |
| Search devices | `GET /api/v1/deployments/directory` lists device IDs, names and versions without allocation/check reads. Concurrent fleet reads share one hydration pass and briefly reuse its result; writes always use fresh preconditions. |
| Review deployment history | `GET /api/v1/deployments/{nodeId}/history` projects the latest 50 job versions still retained by Nomad to driver version, image digest reference, requested state and revision. It does not expose raw job definitions or past settings. |
| Handle validation errors | Response bodies preserve `error` and add a stable `code` and optional `details`. For `invalid_settings`, `details.fields` contains `{field, code}` entries. Unknown runtime failures return a generic error; raw job payloads and driver logs are not part of this contract. |

**Long downloads and builds:** send `Prefer: respond-async` on the retain PUT or build POST. Supply a client-generated lowercase UUID in `Idempotency-Key` before sending the request. The response is `202 Accepted` with the operation record and a `Location` header. Poll `GET /api/v1/operations/{id}` until `succeeded`, `failed`, or `interrupted`; `GET /api/v1/operations` lists the most recent 50. Success identifies the retained release and digest. Retry the same request with the same key after a transport timeout. Reusing the key for different input returns `409 operation_key_conflict`.

The journal in `DRIVER_HUB_DATA_DIR/operations` is for **one running manager per data directory** and needs a filesystem supporting hard links and atomic rename. Up to four asynchronous acquisitions may run concurrently; the build worker still runs one build at a time. Restarted managers report unfinished operations as `interrupted`, never automatically replay them. Check the retained releases before initiating a new operation with a new key. Old keys remain reserved while their records are retained. Existing clients that omit `Prefer` keep the original synchronous behavior.

## Monitoring and failover

Linux Nomad clients need a healthy Docker task driver and access to VideoIPath, the device, Nomad Variables and the image service. Jobs constrain placement to a supported architecture. Resources currently default to 500 MHz CPU and 256 MiB per task; qualify driver-specific requirements before production use.

Use datacenters containing only qualified clients. Architecture matching alone does not establish CPU variant compatibility, VLAN routing or spare capacity. Confirm both the actual device read and VideoIPath session on each eligible host, including after a cold pull. Digest-pinned jobs permit reuse of an exact local image; a cold client still needs the complete registry graph. A manifest HEAD checks the backing file and length, not every blob or its hash. Measure a warm restart with the registry down separately from a cold replacement with the manager absent.

An optional declaration extension, `"controlHealth":{"port":8080,"path":"/control"}`, tells Hub to register an HTTP check with Nomad service discovery. Use it **only** for a driver endpoint that returns success when both its VideoIPath session and device communication are working. The driver must listen on the declared container port. Hub returns `driver-reports-connected` only for a recent successful check on the current running allocation, `check-failed` for a recent failure, and `unknown` without fresh evidence. Approval is always `unknown` in this API. Container liveness alone is not a control check.

Nomad's service scheduler restarts or reschedules the job without Hub intervention. Updates have no canaries. The job uses [`disconnect.stop_on_client_after`](https://developer.hashicorp.com/nomad/docs/job-specification/disconnect) (30 seconds) to have a disconnected client stop its task. This is **not hard fencing**: it depends on the Nomad agent still running and on synchronized clocks. If a driver survives a frozen agent or a management partition, two instances may compete for the same VideoIPath session. For sites requiring a strict single-writer guarantee, commission host or network fencing before enabling automatic takeover; a successful clean host-loss test does not prove partition safety.

Qualify orderly drain, hard host loss, loss of all server connectivity while the device remains reachable, and a frozen client agent separately. Measure last/first successful device reads and any overlap using an independent observer. Neither a `lost` allocation nor an empty allocation history proves physical termination. Losing the Nomad control plane can itself interrupt driver service. Keep approval, rollout status and driver-reported communication as separate signals.

## Import a local image

`PUT /api/v1/imports/{driverId}/{version}` verifies a prebuilt image and adds it to **retained releases**. Use a normal driver ID and SemVer, e.g. `meter/1.2.0`. Uploading does not run the driver, publish it upstream, or contact GitHub, Docker or Nomad. It requires an administrator; browser requests use the usual session cookie and `X-Driver-Hub-Request: 1`.

In **Catalog → Import local image**, supply the archive, driver ID and version. Under **Optional details**, add configuration if the driver expects Hub to supply inputs or monitor a control health check. The verified release appears under **Retained releases**.

Send a multipart form with:

- `image`: a **gzipped OCI image-layout tar** (up to 2 GiB compressed, 8 GiB expanded). Use a single manifest or a multi-platform index for one image, not a collection of separately tagged images. An ordinary Docker save archive without an OCI layout is not supported.
- `metadata` (optional): UTF-8 JSON (up to 256 KiB). `displayName` defaults to the driver ID. `source.commit` (full lowercase Git hash) and `source.directory` are independently optional provenance fields. Omitting `configuration` declares no driver inputs or control health check. Supply a declaration when the driver needs them.

For example, save this as `metadata.json`, substituting the actual source revision and configuration:

```json
{
  "displayName": "Meter",
  "source": { "commit": "0123456789abcdef0123456789abcdef01234567", "directory": "Drivers/Meter" },
  "configuration": {
    "schemaVersion": 1,
    "inputs": [{ "name": "deviceHost", "type": "string", "required": true, "env": "DEVICE_HOST" }]
  }
}
```

```sh
curl --fail-with-body -X PUT http://localhost:8080/api/v1/imports/meter/1.2.0 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F 'metadata=<metadata.json;type=application/json' \
  -F 'image=@image.oci.tar.gz;type=application/gzip'
```

The synchronous response contains the retained release and its `Location`: `201` for a new release, `200` for an identical retry, `409 release_conflict` if that driver/version already has different content. Retry with the same archive bytes and metadata; choose a new version for changed content. The manager computes the archive and configuration checksums, verifies the image graph, and records the image digest, platforms and `customer` origin. Only a completed import appears in `GET /api/v1/retained`. Use the ordinary deploy-form, staging, update and rollback endpoints from there.

After staging, an imported release is a normal Nomad-managed deployment. The same status, allocation, evaluation and history endpoints apply. Include `configuration.controlHealth` if the driver exposes a device-communication check; without it, the Hub can report process state but cannot verify device communication.

Allow temporary disk space in the manager data volume for both the compressed archive and verification scratch space. At most two imports run concurrently (`429` when busy). Oversized requests return `413`, an unsupported upload format `415`, and invalid release metadata or OCI content `422`. Partial imports are discarded; abandoned upload workspaces are cleaned when the manager restarts.

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

`node --test test/active-nomad.test.js` exercises an **active Docker allocation** on an explicitly supplied test cluster. Set `DRIVER_HUB_TEST_ACTIVE_NOMAD` to its API URL, `DRIVER_HUB_TEST_IMAGE_HOST` to the address of its test distribution service, and `DRIVER_HUB_TEST_IMAGES_DIR` to that service's writable image directory. Optional settings: `DRIVER_HUB_TEST_NOMAD_TOKEN`, `DRIVER_HUB_TEST_NAMESPACE`, `DRIVER_HUB_TEST_DATACENTER`, `DRIVER_HUB_TEST_PLATFORM`. A Docker/Buildx-capable test runner builds two small HTTP probe images. The suite creates a unique job-scoped Nomad Variable containing a public marker, checks env and file delivery and the exact node UUID, waits for current-allocation check results after start/update/rollback, verifies stop, and removes its own job, Variable and images. It needs test-only Variable write/delete permissions in addition to the manager permissions. Run it only on a dedicated test installation. The synthetic probe makes no VideoIPath or device requests.

**Site acceptance:** use a test device and two eligible Nomad clients. Stage and start one approved driver, verify a real control read, update it and roll back with the same UUID. With the manager host powered off, fail the active driver host and verify that the cold client pulls the exact digest, reads its configuration and restores actual device communication. Record recovery time. Separately partition the old host's management network while its device network remains reachable and test site fencing. Only then claim the site meets its HA target.

**Backend handoff evidence:** a disposable Linux Nomad 1.10.5 client with Docker ran the synthetic active-allocation suite, including both forms of Variable delivery and check transitions for two image versions. The complete suite passed with the runtime tests enabled and run serially. Earlier lab runs also encountered intermittent staging/image-pull failures on the Windows/Docker Desktop shared-filesystem setup; their cause was not established. The passing run is a single-client lifecycle result, not a storage availability or partition-fencing qualification.
