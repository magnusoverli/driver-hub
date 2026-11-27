# Running Driver Hub

Operators use the manager's web app; scripts use the same `/api/v1` endpoints. The customer operates Nomad, and device approval remains in VideoIPath.

## Installation

Use the [Docker Compose installation](README.md#deploy-with-docker-compose) with Compose v2.20+ (or newer) and Linux containers. The `linux/amd64` and `linux/arm64` variants each include the manager, built web frontend, Docker CLI/Buildx and matching image-service package. Compose selects the platform for the Docker host. Choose a host architecture matching the Nomad clients that should run the image service.

Compose binds the management UI/API to `127.0.0.1:8080` on the host. For remote browser access, put that listener behind HTTPS and preserve the public `Host` header at the reverse proxy. The manager requires authentication even on loopback. The browser uses a `Secure` session cookie; scripts use [Hub API tokens](#api-tokens).

### Registry access

For a private GHCR package, run `docker login ghcr.io --username YOUR_GITHUB_USERNAME` on the deployment host. At the password prompt, use a GitHub personal access token (classic) with `read:packages`; the account must have read access to the package. Public packages can be pulled anonymously. Registry credentials belong in Docker's credential store, not the Hub `.env`. Nomad clients fetch their image-service package from Hub and do not need a GHCR login.

### Installing the manager from a release asset

Download `driver-hub-<tag>-linux-amd64.tar.gz` or `driver-hub-<tag>-linux-arm64.tar.gz` from the GitHub Release to match your Docker host. `docker load` restores the same versioned image tag used by Compose. For example, for `v0.0.1` on AMD64, set `DRIVER_HUB_IMAGE=ghcr.io/magnusoverli/driver-hub:v0.0.1` in `.env` beside the matching `compose.yaml`, then run:

```sh
docker load -i driver-hub-v0.0.1-linux-amd64.tar.gz
docker compose pull buildkit
docker compose up -d --pull never
```

Only the manager is in the archive. Skip the BuildKit pull if the exact worker image in `compose.yaml` is already available locally.

### Upgrading a Compose installation

Back up the manager data, keep the Compose project name and data volume, and take the `compose.yaml` from the new release. Set `DRIVER_HUB_IMAGE` in `.env` to the new versioned image (or its `tag@sha256:…` reference), then run `docker compose pull` and `docker compose up -d`. This recreates the manager and signs operators out. Reconciliation rolls out a changed image-service package to Nomad; check **Settings → Nomad → Image distribution** and the expected client count. Keep the previous image reference and backup for rollback. Do not use `down -v` during an upgrade.

The supplied project name remains `driver-hub-trial` for compatibility. For an installation previously built by `docker compose up --build`, add `DRIVER_HUB_IMAGE` to its existing `.env` before using the new Compose file. Keep any site-specific override file. Accounts are stored in the data volume; the new Compose file does not read the old `DRIVER_HUB_INITIAL_PASSWORD` variable. To continue building locally with the bundled Buildx tools, follow the [local image build](README.md#build-the-manager-image-locally).

### Publishing a manager release

Publish a **GitHub Release** from a commit containing [the image workflow](.github/workflows/release-image.yml), using a tag such as `v1.2.3` or `v1.2.3-rc.1` (`alpha.N` and `beta.N` are also accepted). A branch push, a bare Git tag, or saving a draft does not publish an image. A published prerelease gets its own exact tag.

The workflow tests the backend and starts the runtime image with the installation Compose file. It verifies the UI, embedded package checksum and an OCI export with the bundled builder after administrator opt-in. Pull requests run verification without publishing. On a published release, a separate job uses GitHub's workflow token with `packages: write` to push the multi-platform image to `ghcr.io/<owner>/driver-hub:<release-tag>`. The job summary gives the digest-pinned reference for `.env`. No `latest` tag is published. Use a new version for changed content and check that the first package's visibility and read access match the intended deployment audience.

After the push, CI pulls each platform from that digest and attaches its Docker image archive to the same GitHub Release. Only the attachment job needs `contents: write`.

### Manager settings

The environment holds only what the manager needs before its web interface runs, or what describes the machine it runs on. Everything else is saved in the site settings and changed under **Settings** in the web interface (or with the endpoints in [site setup](#site-setup-after-container-startup)). Settings > Manager lists the values below as the running manager sees them; changing one takes a restart.

| Setting | Where | Purpose |
| --- | --- | --- |
| `HOST`, `PORT` | Manager | Bind address and port of the API and web interface. Defaults to `127.0.0.1:8080` natively; the container binds `0.0.0.0`. |
| `DRIVER_HUB_DATA_DIR` | Manager | Durable archive and release metadata, verified images (`images/`), accounts and site settings; default `~/.driver-hub`. |
| `DRIVER_HUB_DISTRIBUTION_PORT` | Manager | Port of the read-only listener the Nomad clients fetch images from (see [image distribution](#image-distribution)); default `5481`, on every interface. |
| `DRIVER_HUB_DISTRIBUTION_ADDRESS` | Manager | Optional. The host, optionally with a port, at which Nomad clients reach that listener. Unset, Hub uses the address it reaches Nomad from. Set it when that address is not reachable from the clients, as in a container with bridge networking. |
| `DRIVER_HUB_WEB_DIR` | Manager | Built frontend to serve; default `web/build` beside `src/`. Without an `index.html` there, the manager serves only the API. |
| `DRIVER_HUB_SITE_KEY_FILE` | Manager | Key for the saved site settings; see the end of [site setup](#site-setup-after-container-startup). |
| `DRIVER_HUB_BOOTSTRAP_USERNAME`, `DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE` | Manager | The first administrator; see [operator sign-in](#operator-sign-in). |
| `DRIVER_HUB_ADMIN_TOKEN` | Manager | Optional emergency administrator bearer token, for when every administrator account is locked out. Prefer API tokens for scripts. |

Saved in the site settings instead:

| Setting | In the web interface | Purpose |
| --- | --- | --- |
| Nomad address, namespace, datacenters, ACL token | Settings > Nomad, Change the connection | Nomad HTTP(S) API, namespace (`default`) and datacenters (`dc1`). Use a stable HTTPS endpoint and a dedicated namespace in production. The ACL must cover driver service jobs, the image system job, allocation checks and the Variables below. |
| Nomad web interface | Settings > Nomad, Jobs | Optional operator-facing HTTPS origin of the target Nomad UI. Adds allocation log links using the operator’s own Nomad login; leave empty if targets do not share that UI. |
| Shared writers | Settings > Nomad, Jobs | On if another process can edit Hub jobs directly. Disables job purge, which has no server-side revision check, so deployments cannot be deleted. |
| Source builds | Settings > Manager | Lets administrators build reviewed source from the public repository using Docker Buildx. Off by default; it can only be turned on when the manager can build (see [customer builds](#customer-builds)). |
| Request timings | Settings > Manager | Returns `Server-Timing` with API duration and upstream call, decoded response byte and error counts. Shared reads are counted on the request doing the work. |
| VideoIPath | Settings > VideoIPath | See [site setup](#site-setup-after-container-startup). |
| API tokens | Settings > API tokens | See [API tokens](#api-tokens). |

### Image distribution

After the Nomad connection is saved, the manager writes the desired image list to `nomad/jobs/driverhub-images`, then registers the `driverhub-images` system job in that namespace and its configured datacenters. No customer registry is needed. Use the Hub container for this workflow: a source checkout without the packaged image service reports `unavailable` with `reason: "no_package"`.

- **Pulls stay on the machine.** Driver jobs pull from `127.0.0.1:5480`, the copy on their own client. Docker accepts plain HTTP from a registry in `127.0.0.0/8` without configuration. Docker documents this, but advises against relying on it; a daemon configured otherwise needs `127.0.0.1:5480` in its `insecure-registries`.
- **Every client keeps a copy.** The service copies the published images on Hub's list from the manager or a peer. If Docker asks for a pinned root manifest before a newly staged image appears on the local list, the service can fetch it on demand and keeps the fresh copy through a one-hour grace period. With the manager down, a replacement driver needs a running local image service and either a local copy or a reachable peer with the complete image.
- **Content is verified.** Hub lists each image's root digest in the job's Nomad Variable, `nomad/jobs/driverhub-images`; copies check every file against its SHA-256, and driver jobs pin the digest, so a source cannot substitute an image.
- **Package upgrades.** The service itself ships as a gzipped `docker save` archive in the Hub container. On installation or upgrade, Nomad fetches `/_hub/image-service-<sha256>.tar.gz` from the manager's distribution port, verifies the job's checksum, and Docker loads that exact filename. A shorter replacement never overwrites an older archive in the retained task directory. Once running, the service removes old package archives and keeps the current one for restart. A client that has never obtained the package needs the manager to bootstrap.

**Reading image status:** Open **Settings → Nomad → Image distribution**, or request `GET /api/v1/integrations/images` as a viewer or administrator. `running` is the number of running current allocations. `upToDate` counts those with a passing `images-copied` check for the list rendered on that client. These counts do not measure driver or device health.

| State | Meaning or next check |
| --- | --- |
| `not_configured` | Save a Nomad connection first. |
| `unavailable` | The manager has no image-service package. Use the packaged Hub container. |
| `starting` | Hub has not finished its first reconciliation, or clients are still starting. Two healthy copies and one pending download can correctly show `running: 2`, `upToDate: 2`, `state: "starting"`. |
| `copying` | Some services are running, but checks or other current allocations are not healthy yet. Look at `problems` and the `images-copied` checks. |
| `ready` | At least one current allocation is running and all current allocations wanted by Nomad pass their copy check. Compare `running` with your expected client count. |
| `failing` | Hub could not reconcile the job or its Variable, or no copy is running and an allocation reported a problem. Check the returned `reason`/`detail` or the task events on the named client. Superseded allocation failures are excluded. |

What it needs from the cluster:

- Port `5480` free on every client. Nomad reserves it for the job, and the service listens on every interface so other clients can copy from it.
- The Docker driver's defaults: host networking and loading an image from a file.
- Disk for the images in use, in the allocation's data directory; it is kept when Nomad replaces the allocation on the same client.
- Clients must reach the manager's distribution listener (default TCP `5481`) for package and image downloads, and each other's TCP `5480` for peer copies. Both are read-only HTTP listeners: restrict them to the client network. For `Failed Artifact Download`, compare the job's artifact URL and checksum with what the client can fetch at the advertised address. Do not disable checksum verification.
- The clients' CPU architecture must match the manager image's (the job is constrained to it).

Back up retained releases, `DRIVER_HUB_DATA_DIR/images` and `DRIVER_HUB_DATA_DIR/labels` (operator-entered device names); use the customer's normal Nomad backup process for jobs and Variables. Do not delete a published digest needed by a running deployment or its rollback version.

**Upgrading from the separate image host:** Remove `imageHost` from scripts that call `PUT /site/deployment`; that field is no longer accepted. Upgrading the manager does not rewrite existing driver jobs. Before retiring the old host, inspect the pinned `image` in `GET /api/v1/deployments/{nodeId}` for each device. For jobs still pointing there, preview a start or version update as appropriate and apply it during the device's maintenance window. Confirm the job now pins `127.0.0.1:5480/driverhub/…@sha256:…` and verify the driver check.

## Operator sign-in

**First administrator:** on a fresh installation, sign in locally as `admin` with `LicenseToDeploy!`. A session using this default can only check its identity, change the password or sign out. Choose a different password of at least 12 characters and sign in again. Changing it invalidates every session for the account. Restarting or upgrading with the existing data volume never resets the password.

For unattended provisioning, set `DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE` to a protected UTF-8 file containing a private initial password (one trailing line ending is ignored). In Docker, mount the file read-only, readable by UID 1000. A distinct private password bypasses the default-password prompt. Set `DRIVER_HUB_BOOTSTRAP_USERNAME` to choose another username. Alternatively, setting only `DRIVER_HUB_ADMIN_TOKEN` preserves token-only bootstrap: create the first admin via `POST /api/v1/users` with the bearer token.

### API tokens

Administrators create bearer tokens for scripts under Settings > API tokens, each with a name and the `admin` or `viewer` role. A request with `Authorization: Bearer <token>` then gets that role without signing in. The token is shown once, when it is created; Hub keeps only its SHA-256 hash in `DRIVER_HUB_DATA_DIR/auth/api-tokens.json`. Deleting a token stops it working at once.

| API | Behavior |
| --- | --- |
| `GET /api-tokens` | Admin only. Lists tokens: `id`, `name`, `role`, `createdAt`, `createdBy`. Never the token. |
| `POST /api-tokens` | Admin only. `{ "name": "...", "role": "viewer" }`. Returns the record with `token`. Names are unique ignoring case (`409 token_name_taken`). |
| `DELETE /api-tokens/{id}` | Admin only. Revokes the token. |

**Frontend:** all paths below are relative to `/api/v1`. On page load, call `GET /auth/session`; a 401 means show the login form. Send `Content-Type: application/json` with JSON bodies and **`X-Driver-Hub-Request: 1` on login, logout, and every non-GET cookie-authenticated request**, including deploy-form previews. Use same-origin fetch so the browser handles the `HttpOnly; Secure; SameSite=Strict` cookie. Do not enable cross-origin credentialed access at a proxy. A bearer header selects service authentication on management routes; omit it when acting as a signed-in user.

| API | Behavior |
| --- | --- |
| `POST /auth/login` | `{ "username": "...", "password": "..." }`. Sets an 8-hour session cookie and returns `{username, role, provider}`. If login or `GET /auth/session` also returns `mustChangePassword: true`, use `POST /auth/password` before accessing management routes (`403 password_change_required`). Bad credentials and disabled accounts return the same 401. Repeated failures or too many concurrent verifications return 429. |
| `GET /auth/session` | Returns the current operator; use `role` (`admin` or `viewer`) to choose which controls to display. The API also enforces permissions. |
| `POST /auth/logout` | Revokes the current session and clears the cookie. Restarting the manager signs everyone out. |
| `POST /auth/password` | A local user supplies `currentPassword` and `newPassword`. Success invalidates all their sessions; sign in again. |
| `GET /users`, `POST /users` | Admin only. List local accounts or create one with `username`, `password`, and `role`. Usernames are case-insensitive; passwords require at least 12 characters (up to 1024 UTF-8 bytes). |
| `PATCH /users/{username}` | Admin only. Supply `role`, `enabled`, and/or a replacement `password`. Changes invalidate the user's sessions. The last enabled local admin cannot be disabled or demoted. |
| `DELETE /users/{username}` | Admin only. Deletes a local account and ends its sessions. Refuses the last enabled admin (`409 last_admin`) and the signed-in operator's own account (`409 own_account`). Recreating the username starts a new account; sessions of the deleted one never become valid again. |

**Persistence and recovery:** back up `DRIVER_HUB_DATA_DIR/auth` with the manager data and restrict access to it. The account store contains salted scrypt hashes and roles. Use one manager per directory. A second admin (or an operator with host access who configures the admin service token and restarts the manager) can reset a forgotten password. Operator sessions are held in memory; signing out does not affect any running driver.

**Future LDAP:** sessions use an identity provider with `authenticate(username, password)` and `resolve(username)`. The provider returns a username, provider identifier, Hub role and authorization revision. Disabled users or changed roles/revisions lose access on the next request. An LDAP provider can map directory groups to Hub roles behind this interface; the browser contract stays the same. Only the local provider is implemented today.

## Site setup after container startup

The supplied Compose file mounts the named data volume at `/data`. Set `DRIVER_HUB_DISTRIBUTION_ADDRESS` in `.env` to the Docker host address the clients can reach; inside the bridge network Hub may see only a container address. After first login, enter the Nomad cluster and VideoIPath target under **Settings**.

The site endpoints below are admin-only; integration status is also readable by viewers. Paths are relative to `/api/v1`. Supply the latest site `revision` on each PUT; it covers all site settings. Tokens are write-only.

| Request | Input and result |
| --- | --- |
| `GET /site` | Returns revision, addresses, namespace, datacenters, `nomad.plainHttp`, token availability and per-device assignments (UUID and SHA-256 token fingerprint). No credential values. |
| `PUT /site/nomad` | `{"revision":0,"address":"nomad.site.example","namespace":"default","datacenters":["dc1"],"token":"<Nomad ACL token>"}`. A bare IP or DNS name uses HTTPS on 4646; an explicit API URL can specify another port. Hub checks the leader and job-list access before saving. Omit the token to keep it on the same target, or send `null` for an ACL-disabled cluster. |
| `PUT /site/deployment` | `{"revision":1,"nomadUiOrigin":"https://nomad.site.example","sharedWriters":false}`. Each field is optional: an omitted one keeps its value, `null` clears the Nomad web interface. |
| `GET /integrations/images` | [Image distribution state and counts](#image-distribution), number of published `images`, manager `source` address and `problems` per client. |
| `PUT /site/manager` | `{"revision":2,"buildsEnabled":true,"timings":false}`. Turning builds on returns `409 builds_unavailable` when the manager cannot build. `GET /site` reports that as `manager.buildsAvailable`. |
| `GET /site/environment` | The startup settings from the table in [installation](#installation): each `name`, `value` in effect, and `source` (`environment`, `default` or `unset`). Secrets report only their source. |
| `PUT /site/videoipath` | `{"revision":1,"address":"vip.site.example","tokens":["<driver token A>","<driver token B>"]}`. Hub normalizes the address to `wss://vip.site.example/x-driver/v1`. The default `tokenMode` is `per-device`. Repeat with the current revision to add more pre-issued tokens. Saving does not open a driver session. |
| `DELETE /site/videoipath/tokens/{fingerprint}?revision=N` | Removes a per-device token from the pool, identified by the SHA-256 fingerprint that `GET /site` lists under `videoipath.pool`. Allowed for an unused token, or one reserved for a device whose deployment no longer exists; a token of an existing deployment returns `409 token_in_use`. Revoke removed tokens in VideoIPath. |

**Trusted development networks:** Hub defaults to HTTPS for credentials sent to a remote Nomad API. If a development cluster serves only HTTP, enter an explicit address such as `http://nomad.dev.example:4646` and select **Send the token over plain HTTP** when keeping or supplying an ACL token. In `PUT /site/nomad`, send `"plainHttp": true`; the saved flag defaults to `false`. Without permission Hub returns `422 nomad_plain_http` before sending the credential. The exception also permits site-managed driver registration over that unencrypted connection. Use HTTPS in production. This setting affects the manager's connection to Nomad, not browser sessions, driver connections to VideoIPath, or the image listener ports.

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
    # The list of images for the image service on the clients.
    path "nomad/jobs/driverhub-images" {
      capabilities = ["read", "write"]
    }
  }
}
```

The `driverhub-*/device/driver` path is only needed for site-managed registration. `read-job` also lets Hub list where the image service runs, to tell the copies about each other. The manager does not need `read-logs`, filesystem access, exec or node administration. Use an HTTPS gateway with client authentication if the site requires mTLS; Hub does not load per-target client certificates. A Nomad connection test exercises leader and list access, not job submission, Variable rights, or the Docker daemon’s path to the registry.

One manager process owns a data directory. Settings, including reservations, are persisted under `DRIVER_HUB_DATA_DIR/site` with AES-256-GCM. By default the key is created alongside the ciphertext: anyone with access to both can decrypt it. To separate the key, mount a file containing exactly 32 random bytes and set `DRIVER_HUB_SITE_KEY_FILE` **before first setup**. Protect and back up the state and corresponding key; losing assignments can lead to token reuse.

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

Linux Nomad clients need a healthy Docker task driver and access to VideoIPath, the device and Nomad Variables, and must run the image service (see [image distribution](#image-distribution)). Jobs constrain placement to a supported architecture. Resources currently default to 500 MHz CPU and 256 MiB per task; qualify driver-specific requirements before production use.

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

**Source builds are available in the standard installation but disabled on a new site.** An administrator enables them under **Settings → Manager**. Both the UI and `POST /api/v1/builds` honor that saved choice. Existing sites keep their saved setting across upgrades.

The manager's Docker CLI/Buildx uses the `hub-compose` builder. Its rootless BuildKit worker communicates over a shared Unix socket, has its own cache volume, and exposes no TCP port or host Docker socket. The worker needs outbound access to the public source repository and any base-image registries. Its container permits nested namespaces, mounts and process sandboxing; use it for reviewed driver source. Builds export OCI archives to Hub, not to a registry.

If the switch is unavailable, check `docker compose ps` and `docker compose logs buildkit`, then `docker compose exec manager docker buildx du`. The host must support rootless BuildKit (unprivileged user namespaces). Restart the manager after restoring the worker: Hub checks builder availability at startup. Allow up to 30 minutes for a build when configuring proxy timeouts.

On Ubuntu 24.04 and other hosts that restrict unprivileged user namespaces with AppArmor, select a host-approved worker profile with `DRIVER_HUB_BUILDKIT_APPARMOR` in `.env`. For example, the following worker-only profile permits rootless namespaces without changing the kernel-wide policy:

```text
abi <abi/4.0>,
profile driver-hub-buildkit flags=(unconfined) {
  userns,
}
```

Install it as `/etc/apparmor.d/driver-hub-buildkit`, load it with `sudo apparmor_parser --replace /etc/apparmor.d/driver-hub-buildkit`, set `DRIVER_HUB_BUILDKIT_APPARMOR=driver-hub-buildkit`, and run `docker compose up -d` followed by `docker compose restart manager`.

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

`npm test` runs API, integrity, concurrent retention and lifecycle tests. Set `DRIVER_HUB_TEST_DOCKER=1` to also build an OCI image and pull it into a fresh client from the image service container. Set `DRIVER_HUB_TEST_NOMAD` to a local Nomad executable to also start a disposable, loopback-only server, register a staged job and verify revision enforcement. These tests require no customer cluster or VideoIPath credentials.

`node --test test/active-nomad.test.js` exercises an **active Docker allocation** on an explicitly supplied test cluster. Set `DRIVER_HUB_TEST_ACTIVE_NOMAD` to its API URL, `DRIVER_HUB_TEST_IMAGE_HOST` to the address of its test distribution service, and `DRIVER_HUB_TEST_IMAGES_DIR` to that service's writable image directory. Optional settings: `DRIVER_HUB_TEST_NOMAD_TOKEN`, `DRIVER_HUB_TEST_NAMESPACE`, `DRIVER_HUB_TEST_DATACENTER`, `DRIVER_HUB_TEST_PLATFORM`. A Docker/Buildx-capable test runner builds two small HTTP probe images. The suite creates a unique job-scoped Nomad Variable containing a public marker, checks env and file delivery and the exact node UUID, waits for current-allocation check results after start/update/rollback, verifies stop, and removes its own job, Variable and images. It needs test-only Variable write/delete permissions in addition to the manager permissions. Run it only on a dedicated test installation. The synthetic probe makes no VideoIPath or device requests.

This standalone test constructs its own Nomad client; it does not inherit the site's `plainHttp` opt-in. Use HTTPS or a loopback address when passing a test token.

**Site acceptance:** use a test device and two eligible Nomad clients. Stage and start one approved driver, verify a real control read, update it and roll back with the same UUID. With the manager host powered off, fail the active driver host and verify that the cold client pulls the exact digest, reads its configuration and restores actual device communication. Record recovery time. Separately partition the old host's management network while its device network remains reachable and test site fencing. Only then claim the site meets its HA target.

**Backend handoff evidence:** a disposable Linux Nomad 1.10.5 client with Docker ran the synthetic active-allocation suite, including both forms of Variable delivery and check transitions for two image versions. The complete suite passed with the runtime tests enabled and run serially. Earlier lab runs also encountered intermittent staging/image-pull failures on the Windows/Docker Desktop shared-filesystem setup; their cause was not established. The passing run is a single-client lifecycle result, not a storage availability or partition-fencing qualification.

**Three-client development trial:** With the manager stopped, Nomad rescheduled a synthetic driver to a different client and its HTTP control check passed. After the manager returned, successively smaller image-service packages rolled out across all three clients. Hub reported `starting` while a client was downloading and `ready` with all three checks passing. Each client served the second probe's exact manifest digest, and its running allocation passed the control check. This exercise used a stopped manager and a rescheduled probe, not a powered-off driver host, a proven empty Docker cache, or a physical device. Those cases remain part of site acceptance.
