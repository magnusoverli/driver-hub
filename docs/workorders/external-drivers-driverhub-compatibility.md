# Work order: make VideoIPath External Drivers fully Driver Hub compatible

- **Repository:** [VideoIPath/VideoIPath_External_Drivers](https://github.com/VideoIPath/VideoIPath_External_Drivers)
- **Issued:** 2026-11-27, from the Driver Hub project
- **Deliverable:** one or more pull requests to that repository. **Do not create tags, GitHub Releases or published images.** Releasing stays with the maintainers.

## 1. Goal

Any driver contributed to this repository should be supported by Driver Hub through its whole life without extra work: listed, version-aware, downloaded and verified, configured, deployed, monitored, updated and rolled back.

To get there:
- The repository's documentation, JSON Schemas, CI and examples must state and enforce one contract, and that contract must match what Driver Hub actually checks.
- At least one example must pass it end to end.

## 2. Context

**Driver Hub** is a separate, private application. You cannot read its code, so its full contract is given in [section 5](#5-the-driver-hub-contract-authoritative). Treat that section as the specification.

What Driver Hub does with this repository:
- It discovers driver releases through the GitHub API and downloads their assets.
- It verifies every checksum and the OCI image.
- It deploys one instance per physical device as a HashiCorp Nomad job using the Docker driver. The driver container connects out to VideoIPath (`wss://…/x-driver/v1`) and to its device.
- It distributes images to the Nomad clients itself, so no registry is involved.
- It can also build a driver from a source commit of this repository.

VideoIPath itself does not deploy external drivers. Driver Hub fills that gap.

## 3. Current state (verified 2026-11-27)

This is already in place and must be kept:

- **Release guide:** `Drivers/RELEASING.md` defines the release convention.
  - Tags are `drivers/<driverId>/v<version>`, with independent SemVer per driver, and published tags are never moved.
  - Each release has four assets: `driver-release.json`, `driver-config.json`, `<name>.oci.tar.gz` and `deployment.tar.gz`.
  - Releases are created as drafts first.
- **Schemas:** `Drivers/schemas/driver-release-v1.schema.json` and `driver-config-v1.schema.json`.
- **Contributor template:** `Drivers/README.template.md`.
- **The Rust example** (`examples/rust_example/`):
  - It is packaged by `scripts/package-driverhub.py`.
  - CI validates both records against the schemas and smoke-tests the image read-only as a non-root user.
  - It is released as `drivers/rust-example/v0.3.0`, with all four assets uploaded.
- **No contributed drivers yet:** `Drivers/Vendor/…` holds only placeholders.

Verified results against Driver Hub's actual validators:

| Check | Result |
| --- | --- |
| Driver Hub lists `rust-example` 0.3.0 | Yes |
| Driver Hub loads it, the step before download and deployment | Yes, since Driver Hub accepted `description`, `maxLength` and length bounds on secrets (gap 1). Before that, it refused the release. |
| Deploy form for a site-connected device | The site and Driver Hub supply `videoipathUrl`, `videoipathToken` and `nodeId`. The form is valid without operator values, and all 9 descriptions reach the operator. |

## 4. Gaps

Each gap has an owner: **[repo]** means this work order; **[Hub]** means Driver Hub's maintainers, out of your scope but listed so you don't work around them.

1. **[Hub, done] Input properties Driver Hub refused.** Driver Hub used to reject `description` and `maxLength`, and `minLength` on secret inputs, although this repository's schema allows all three and the Rust example uses them.
   - **Now:** Driver Hub accepts them. It shows `description` to operators, enforces `maxLength` on values operators enter, and accepts but does not apply length bounds on secrets, whose values it never sees.
   - **Do not remove them from the example.** Your schema and docs should list them as supported.
2. **[repo] The config schema forbids Driver Hub's top-level keys.** `driver-config-v1.schema.json` has `additionalProperties: false` at the top level and only `schemaVersion` and `inputs`. A driver therefore cannot declare `controlHealth`, `nodeIdInput` or `videoIPathInputs`, all of which Driver Hub supports and relies on.
3. **[repo] The schema is looser than Driver Hub in other places.** Examples: input name pattern, `env` name pattern, `file` path rules, unique bindings, the `NOMAD_` prefix, defaults that must satisfy their own bounds. A config can pass CI and still be refused by Driver Hub.
4. **[repo] The Rust example is never shown as connected.** It has no HTTP health endpoint, only a local heartbeat file and a `readiness` file. Driver Hub can only report "driver reports connected" through `controlHealth`, so today the Rust example would always show communication as *not observable*.
5. **[repo] The shutdown timeout leaves no margin.** `DRIVER_SHUTDOWN_TIMEOUT_MS` defaults to 5000 and allows up to 10000. Driver Hub gives a task **5 seconds** after the stop signal before killing it, so the default leaves no margin and the maximum is never reached.
6. **[repo] Behaviour under Driver Hub is undocumented:**
   - no persistent storage;
   - exactly one instance per node ID, moved between machines;
   - fixed resources;
   - secrets supplied as Nomad Variable key names;
   - inputs Driver Hub fills in itself.
   `RELEASING.md` covers the release format and Compose, not these. In particular, `DRIVER_STATE_DIRECTORY` and `DRIVER_LOCK_DIRECTORY` need a stated meaning under Driver Hub.
7. **[repo] The Python example can't be deployed.** It has no Dockerfile and no `driver-config.json`, so Driver Hub cannot deploy it. Nothing says so.
8. **[repo] Packaging and CI only cover the Rust example.** `package-driverhub.py` and `.github/workflows/rust-example.yml` are specific to it. A driver added under `Drivers/<Vendor>/<Driver>` gets no validation or packaging.
9. **[repo] Minor:** CI pins Rust 1.98.1, but the Dockerfile builds with `rust:1.100.0`. Align them, or document why they differ.

## 5. The Driver Hub contract (authoritative)

This is exactly what Driver Hub enforces today. Write it into the repository's documentation and schemas.

### 5.1 Discovery and listing
- **Source:** Driver Hub lists GitHub Releases of this repository in pages of 50.
- **What counts:** a release is a candidate only if:
  - it is not a draft;
  - its tag matches `^drivers/([a-z0-9]+(?:-[a-z0-9]+)*)/v(<SemVer 2.0.0>)$`. SemVer here has no leading `v` inside the version and no leading zeros.
  - it has an **uploaded** asset named exactly `driver-release.json`.
- **Prereleases:** a release is a prerelease if it is marked so on GitHub, or if its version (ignoring build metadata) contains `-`. Prereleases are hidden unless the operator asks for them.
- **Reserved versions:** versions starting `0.0.0-local.` belong to Driver Hub's local builds and are refused.

### 5.2 Release record (`driver-release.json`)
- **Identity:** `schemaVersion: 1`, plus `driverId` and `version` equal to the tag's values.
- **`displayName`:** non-empty.
- **`source`:** `commit` (40 lowercase hex) and `directory` (non-empty).
- **`origin`:** absent or `"maintainer"`.
- **`configuration`:** `{ "file": "driver-config.json", "sha256": <64 hex of the asset's bytes> }`.
- **`image`:**
  - `digest`: `sha256:<64 hex>`, the root manifest or index descriptor digest;
  - `archive`: an asset name matching `^[\w.-]+\.tar\.gz$`;
  - `archiveSha256`: 64 hex of the archive's bytes;
  - `platforms`: a non-empty list such as `["linux/amd64"]`.
- **Extra fields** (`deploymentBundle`) are ignored by Driver Hub and may stay.
- **Asset names:** the assets named by `configuration.file` and `image.archive` must be uploaded on the same release.

### 5.3 Image archive
- **Format:** a gzipped OCI image layout: `oci-layout` with `imageLayoutVersion` 1.0.0, `index.json` and `blobs/sha256/…`.
- **Size limits:** at most 2 GiB to download, 8 GiB expanded and 32,768 entries.
- **Structure:** the root is the record's `image.digest`. It is either one image manifest, or an index with exactly one manifest per platform, each carrying a platform descriptor.
- **Verification:** every reachable blob must be present with the right size and SHA-256. Every image config must state `os` and `architecture` (and `variant` if any). Every platform listed in the record must be in the image.
- **Platforms Driver Hub can run:** `linux/amd64` and `linux/arm64`. Driver Hub runs its image service on clients of both architectures, and places a driver only on architectures its image contains. A multi-platform image therefore runs on a mixed cluster.

### 5.4 Configuration declaration (`driver-config.json`)
Top level: `schemaVersion: 1`, `inputs` (array), and optionally the three keys below.

- **`controlHealth: { "port": <1–65535>, "path": <string> }`.** The path matches `^/[A-Za-z0-9_/-]*$` and contains no `//`. See 5.6.
- **`nodeIdInput: <input name>`.** It must name a non-secret `string` input without a `default`. Use it only if the node ID is not bound to `VIDEOIPATH_NODE_ID`.
- **`videoIPathInputs: { "url"?: <input name>, "token"?: <input name> }`.**
  - It names the inputs that carry the VideoIPath endpoint and token, if they are not bound to `VIDEOIPATH_URL` and `VIDEOIPATH_TOKEN`.
  - `url` must be a non-secret string and `token` a secret string.
  - Neither may be the node-ID input, nor bound to `VIDEOIPATH_NODE_ID` or the other role's canonical variable.
  - No other input may be bound to that role's canonical variable.

Each input:
- **`name`:** matches `^[A-Za-z][\w.-]*$` and is unique.
- **`type`:** `string`, `integer` or `boolean`.
- **`required`:** a boolean.
- **Binding:** exactly one of:
  - `env`, matching `^[A-Za-z_][A-Za-z0-9_]*$` and not starting with `NOMAD_`;
  - `file`, an absolute path matching `^/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+$`, with no `.` or `..` segments. It is mounted read-only.

  Bindings are unique across inputs.
- **`secret`:** strings only, and never with a `default`.
- **`default`:** must itself be valid for the input.
- **`description`:** optional. A non-empty string of at most 1,000 characters, shown to operators as the input's hint.
- **Bounds:**
  - `minimum` and `maximum` apply to integers only, with `minimum ≤ maximum`.
  - `minLength` and `maxLength` apply to strings only, are ≥ 0, and `minLength ≤ maxLength`.
  - On a non-secret string, Driver Hub enforces them on the value.
  - On a secret, they are accepted but not applied, because the operator enters only the name of a key (below).
- **Anything else is refused.**

Inputs Driver Hub supplies itself (operators cannot override them):
- **`VIDEOIPATH_NODE_ID`:** the device's stable, lowercase, non-nil UUID. Driver Hub always sets it, whether or not the driver declares it.
- **`VIDEOIPATH_URL` and `VIDEOIPATH_TOKEN`:** filled from the site when the device takes its VideoIPath target from the site (the default). The URL is the complete `wss://<host>/x-driver/v1`, and the token is reserved per device from a pool. If the driver does not declare these inputs, Driver Hub adds them. For a manually connected device, the operator enters them.

**Secrets:** for a secret input, the operator never enters the value. They enter the *name of a key* (`^[A-Za-z_][A-Za-z0-9_]{0,127}$`) in the Nomad Variable `nomad/jobs/driverhub-<node UUID>`. Nomad renders the value into the declared environment variable or read-only file when the task starts. The driver must therefore read secrets from its env variable or file at start-up, and must not log them.

### 5.5 Runtime under Driver Hub
- **One instance:** each device runs as exactly one instance of the image, a Nomad job with count 1, pinned by digest. It is stopped when requested.
- **Replacement:** if its machine loses contact for 30 seconds, Nomad stops that instance and starts a replacement on another machine with the same node ID. VideoIPath lets a newer session with the same node ID replace the older one. The driver must tolerate both being replaced and replacing.
- **Stop signal:** Driver Hub sets SIGTERM explicitly on every driver task. Handle SIGINT the same way, for running outside Driver Hub. After **5 seconds** the task is killed. Finish the shutdown (closing the session and releasing the device) well within that time.
- **Resources:** fixed at 500 MHz CPU and 256 MiB memory.
- **Restarts:** every restart, update or move starts from a fresh container. No volume is mounted except declared `file` inputs. Nothing written inside the container survives, so state must be rebuildable from VideoIPath and the device.
- **Network:** outbound connections only (VideoIPath, device), apart from the `controlHealth` port. The image's default `ENTRYPOINT`/`CMD` must start the driver.
- **Filesystem:** the container may run with a read-only root file system. Anything the driver writes must go to a path that works without a volume, such as a directory the image owns or a temporary file system, and the image should not run as root.

### 5.6 Monitoring (`controlHealth`)
- **The check:** Driver Hub registers a Nomad HTTP check named `driver-communication`. It sends GET `path` on `port` every 10 s, with a 2 s timeout. The driver must listen on that port on all interfaces inside its container; Driver Hub maps a host port to it.
- **Meaning of a 2xx answer:** Driver Hub reports **"driver reports connected"**. Answer 2xx only while **both** the authenticated VideoIPath session is established **and** communication with the device works. A live process alone is not enough. Otherwise answer non-2xx.
- **Staleness:** a result older than 30 seconds, or no single current instance, counts as unknown.
- **No `controlHealth`:** communication shows as *not observable*.
- **Approval:** VideoIPath approval is never reported as verified by Driver Hub.
- **Security:** the endpoint must not expose secrets, issue device commands or require authentication.

### 5.7 Updates and rollback
- **Suggestions:** Driver Hub suggests the newest stable version of the same `driverId`, compared by SemVer numerically. A stable release beats a prerelease of the same core version. Local builds are never suggested as outdated.
- **Update:** keeps the node ID and current values, and re-validates them against the new version's declaration. A version that adds a required input without a default is refused until the operator enters it. When the operator edits values for the new version, inputs it no longer declares are dropped.
- **Rollback:** restores the previous version with the values saved with it.
- **Consequences for authors:**
  - Keep input names and bindings stable across versions.
  - Add new inputs as optional with defaults where possible.
  - Never reuse a version number or change a published release's assets.

### 5.8 Building from source (Driver Hub's customer builds)
- **Source:** Driver Hub builds `https://github.com/VideoIPath/VideoIPath_External_Drivers.git#<commit>:<directory>` with Docker Buildx, for `linux/amd64` or `linux/arm64`, with a 30-minute limit.
- **Directory:** `<directory>` matches `^(Drivers|examples)(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)+$`. A `Dockerfile` must be at its root, and it must build with that directory as the whole build context.
- **Configuration:** `<directory>/driver-config.json` at that commit is used, unless the operator supplies one.
- **Versioning:** the result becomes version `0.0.0-local.<uuid>` of the chosen `driverId`.

## 6. Tasks for this repository

Do them in this order. Each task's acceptance criteria must hold before the PR is ready.

### T1. Align the schemas with section 5
- **What:** update `driver-config-v1.schema.json` with:
  - the optional top-level `controlHealth`, `nodeIdInput` and `videoIPathInputs`, with the rules in 5.4;
  - every input rule in 5.4 that JSON Schema can express;
  - `description`, `maxLength` and secret length bounds kept as allowed (gap 1).
- **Cross-field rules:** some rules can't be expressed in JSON Schema: unique names and bindings, defaults within bounds, `nodeIdInput` and `videoIPathInputs` references, and the `VIDEOIPATH_*` rules. Add a small validator script in the repository for them, and run it in CI next to the schema.
- **Release schema:** check `driver-release-v1.schema.json` against 5.2. Keep `deploymentBundle`. If the `source.directory` pattern (currently `Drivers/<vendor>/<driver>` or exactly `examples/rust_example`) is kept, document it; it is stricter than Driver Hub's, which is fine.
- **Acceptance:**
  - Fixtures under `Drivers/schemas/tests/` (or similar) cover at least one valid and one invalid case per rule, and CI runs them.
  - The Rust example's current `driver-config.json` passes.
  - A config using `label`, `NOMAD_X`, a duplicate binding or a relative `file` fails.

### T2. Health endpoint in the Rust example
- **What:** add an optional HTTP control-health endpoint with the meaning in 5.6. Keep it bound to a configurable port, plain HTTP, and dependency-light. The existing `readiness` state (`device=<bool>` and `videoipath=<bool>`, both required) is the natural source.
- **Declare it:** add `"controlHealth": { "port": <port>, "path": "/control" }` (or a path you justify) to `driver-config.json`. If the port is configurable through an input, the declared port must equal that input's default, and the docs must say Driver Hub always uses the declared port.
- **Keep existing behaviour:** the heartbeat health and the Compose behaviour must not change.
- **Acceptance:**
  - Tests cover 2xx only while the session is authenticated and the device is reachable, and non-2xx before connecting, after losing the session, and while the device is unreachable.
  - The endpoint answers within 2 s and never touches the device or VideoIPath.
  - It works with a read-only root file system as a non-root user (extend the existing smoke test).

### T3. Shutdown inside Driver Hub's limit
- **What:**
  - Lower the Rust example's default `DRIVER_SHUTDOWN_TIMEOUT_MS` so that a full shutdown fits in 5 s with margin, for example 4000.
  - Document that values above about 4500 are not honoured under Driver Hub.
  - Confirm that SIGTERM, which Driver Hub sends, and SIGINT both start the shutdown.
- **Acceptance:** a test or smoke script sends SIGTERM to the running container, and the process exits with the session closed in under 5 s.

### T4. Behaviour under Driver Hub, in documentation
- **`Drivers/RELEASING.md`:** add a section **"Driver Hub compatibility"** that covers all of section 5 in contributor language: listing, versioning, assets, image, declaration (with the Hub-supplied inputs and the secret model), runtime, monitoring, updates, and building from source.
  - Keep it accurate to section 5. Do not invent requirements.
  - End it with a short **checklist** a contributor can tick off.
- **Rust example `README.md` / `OPERATIONS.md`:** state what happens under Driver Hub:
  - `DRIVER_STATE_DIRECTORY` and `DRIVER_LOCK_DIRECTORY` are per-container and lost on every restart.
  - The lock does not span machines; single ownership comes from Nomad's single instance plus VideoIPath's node-ID takeover.
  - Fixed resources.
  - The health endpoint.
- **`Drivers/README.template.md`:** add a "Driver Hub" section with:
  - the inputs table: name, type, required, binding, secret, default, description, and who supplies it;
  - the health endpoint;
  - the supported platforms;
  - a link to the checklist.
- **Acceptance:** a reviewer can check a new driver against the checklist without reading any other document. Every statement matches section 5.

### T5. The Python example
- **What:** state in `examples/README.md` and `examples/Python/README.md` that the Python example is a protocol reference only, and that Driver Hub cannot deploy it (no image, no declaration). Do not package it unless a maintainer asks.
- **Acceptance:** neither README implies it is deployable.

### T6. Validation and packaging for every driver
- **Packaging script:** generalise `package-driverhub.py` into a repository-level tool, for example `tools/package-driver.py --directory <dir> --driver-id <id> --display-name <name> [--platform linux/amd64 …]`.
  - It reads the version from the driver's own manifest, or takes `--version`.
  - It builds from `git rev-parse HEAD` like today, and never tags or publishes.
  - The Rust example uses it.
  - It supports a multi-platform index (amd64 and arm64) as in 5.3, but defaults to one platform.
- **CI:** add a workflow, or a reusable job, that runs for every changed directory under `Drivers/**` containing a `driver-config.json`. It must:
  - validate it (T1);
  - build the Dockerfile with that directory as the whole context (5.8);
  - package it;
  - validate the produced `driver-release.json`;
  - verify the OCI archive (`skopeo` as today);
  - run a read-only, non-root container smoke test.
- **Toolchain:** fix the Rust version mismatch (gap 9).
- **Acceptance:** CI passes for the Rust example through the new path. Adding a minimal sample driver under a temporary test directory is validated, then removed; describe in the PR how you exercised it.

### T7. Prepare, but do not publish, the next Rust example release
- **What:**
  - Bump the Rust example's version for the changes above: minor, since `controlHealth` is new and the shutdown default changed.
  - Update `CHANGELOG.md`.
  - Run the packaging tool locally or in CI, and attach the four produced files as CI artifacts.
- **Acceptance:** the artifacts pass every check in T1 and T6. The PR description lists the exact steps a maintainer runs to tag and publish (draft first, as `RELEASING.md` says).

## 7. Constraints
- **No releases:** do not create or move tags or releases, and publish no images.
- **No rewrites:** do not rewrite history.
- **Example inputs:** keep the Rust example's existing input names and bindings unchanged (5.7).
- **Licence and conventions:** GPL-3.0 applies. Follow `CONTRIBUTING.md`, the code style, and the existing CI conventions (pinned actions and digests, Trivy scans).
- **Uncertainty:** where section 5 and this repository disagree, follow section 5, except gap 1. If something in section 5 seems wrong or impossible, stop and raise it in the PR instead of working around it.
- **Scope:** keep changes focused. One PR per task, or a small number of reviewable PRs.

## 8. Report back
When done, report:
- the PR links;
- the result of each acceptance criterion and how you checked it;
- anything in section 5 that you could not implement or that the repository contradicts;
- open questions for the maintainers.
