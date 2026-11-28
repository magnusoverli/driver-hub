# Work order: publish machine-readable driver configuration constraints

**Owner:** agent maintaining `VideoIPath/VideoIPath_External_Drivers`  
**Deliverable:** a pull request with a versioned configuration schema, packager support, representative declarations, conformance tests, and contributor guidance. Do not tag a release, publish an image, or modify existing release assets.

## Problem to solve

Driver Hub deployed `rust-example` v0.3.0 to a `ws://` target. Its declaration described a WSS endpoint but only required a nonempty string. Nomad successfully launched the container; the executable rejected the URL before attempting registration. The same gap exists when a driver accepts only particular string values. We need release-specific constraints a consumer can enforce, not more detailed prose or a Rust-specific exception.

## 1. Agree on the declaration format with Driver Hub

Propose `driver-config.json` **schemaVersion 2** alongside v1. Keep the release manifest, asset names, checksum conventions, and existing input bindings unchanged unless inspection identifies a necessary change. The following is a proposed input, not an already-shipped Hub API:

```json
{
  "name": "videoipathUrl",
  "type": "string",
  "required": true,
  "env": "VIDEOIPATH_URL",
  "url": {
    "schemes": ["wss"],
    "path": "/x-driver/v1",
    "allowCredentials": false,
    "allowQuery": false,
    "allowFragment": false
  }
}
```

- `url` constrains an absolute URL on a non-secret string input, regardless of its name or whether the value comes from the operator, a site profile, or a default. Require a nonempty list of distinct schemes. Specify exact path matching, scheme normalization, and the behavior of omitted options in the contract. A base registration URL excludes the query; the **driver** adds its stable `node_id` when opening the socket.
- Add an optional string `enum`, e.g. `["trace", "debug", "info", "warn", "error"]`. Define exact, case-sensitive membership. Reject empty or duplicate choices, invalid combinations and defaults that violate declared constraints.
- Keep constraints attached to inputs. A backend URL and a physical-device URL in the same driver may legitimately accept different schemes. Missing metadata means **not declared**, not “all schemes supported.” Do not infer constraints from descriptions or assume every driver supports plaintext.
- Provide small, shared JSON fixtures with input values and expected validation outcomes. Agree on names, semantics, and fixtures with the Hub maintainer **before publishing any v2 assets**.

## 2. Implement the producer side

| Area | Required outcome |
|---|---|
| Schema | Inspect `Drivers/schemas/driver-config-v1.schema.json`; retain v1 compatibility and add its v2 counterpart. Unknown versions and misspelled constraint keys must fail clearly. |
| Packaging and CI | Inspect `scripts/package-driverhub.py` and every release-validation entry point. Select validation by the declaration's version, validate semantic rules that JSON Schema cannot express, and fail packaging on invalid declarations. Verify that the manifest checksum covers the exact declaration bytes shipped. |
| Rust example | Update the source declaration under `examples/rust_example/` for a **future** release. Declare WSS only, and encode actual enumerated values such as log level and configuration order after checking the executable parser. Do not add WS support or change runtime behavior merely to fit the schema. |
| Author documentation | Update `Drivers/RELEASING.md` and the contributor template. Show a WSS-only backend, an explicitly dual-scheme example for drivers that genuinely support it, and an enumerated setting. Explain how to distinguish a driver requirement from a site prerequisite such as DNS, CA trust, or a reachable listener. |

## 3. Acceptance tests

1. Existing v1 fixtures still package; v2 fixtures round-trip without losing constraints. Unsupported versions and invalid defaults fail before creating a publishable artifact.
2. Apply the same generic validator to two differently named URL inputs with opposite scheme policies. Assert both accepted and rejected cases. Cover wrong path, credentials, query, fragment, and an invalid enum value.
3. Test the Rust declaration against its **actual configuration parser**, not only a second copy of the validation rules. With all other inputs valid, a `wss://…/x-driver/v1` base URL passes configuration parsing; the equivalent `ws://` URL fails. Exercise representative accepted/rejected enum values too. No live VideoIPath, token, or Nomad cluster is required.
4. Demonstrate a dry-run package and checksum verification. Include commands, results, fixture paths, and any known constraints not yet expressible in the PR.

## Rollout and ownership

The Hub team owns consuming v1/v2, validating effective values before deployment or token reservation, lifecycle checks, UI messages, and policy for undeclared capabilities. The external-driver repo owns truthful declarations tied to immutable artifacts. Older Hub versions reject unfamiliar declarations: coordinate reader support **first**, then have maintainers publish a **new** driver version. Leave `drivers/rust-example/v0.3.0`, its checksums, and its images untouched. This work does not require deploying a driver or changing VideoIPath.
