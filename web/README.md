# Driver Hub web frontend

A static single-page app built with Svelte 5 (runes) and SvelteKit 3. The manager (`../src/main.js`) serves the build from `web/build` on the same origin as `/api/v1`, with a strict Content-Security-Policy. There is no frontend server. Signing in uses the manager's `HttpOnly` session cookie; service tokens never reach the browser.

## Develop

Requires Node.js 22.17 or newer and npm 11 or newer (the lockfile uses npm 11 peer resolution).

```sh
npm ci
npm run dev        # http://localhost:5173, forwards /api to a manager on 127.0.0.1:8080
```

Run a manager next to it (`npm start` in the repository root, with `DRIVER_HUB_BOOTSTRAP_PASSWORD_FILE` on first start). Set `DRIVER_HUB_DEV_API` to forward to another manager. Open the dev server at `localhost`: the session cookie is `Secure`, which browsers accept over plain HTTP only there.

| Command                           | Purpose                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run verify`                  | Everything below that CI should run.                                                                               |
| `npm run api:check`               | Fails when `src/lib/api/schema.d.ts` no longer matches the backend contract. `npm run api:types` regenerates it.   |
| `npm run lint` / `npm run format` | Prettier and ESLint.                                                                                               |
| `npm run check`                   | Svelte and TypeScript type checking.                                                                               |
| `npm test`                        | Unit tests (Node), component tests (Chromium) and end-to-end tests.                                                |
| `npm run test:e2e`                | Builds the app and runs Playwright against a real manager on a throwaway data directory (`e2e/serve-manager.mjs`). |
| `npm run demo`                    | Serves the app with seeded deployments on `http://localhost:4182`, without a Nomad cluster (see below).            |

The end-to-end tests run two managers: a fresh site on port 4180, and one on port 4182 connected to the fake Nomad in `e2e/cluster/`. That stand-in implements the Nomad API calls the manager makes and keeps jobs, versions, allocations and evaluations in memory. Retained releases are tiny but valid OCI images, and every device is staged, started and updated through the manager's own API, so the deployment screens see exactly what the backend reports. Tests set conditions such as a failing control check through its `/_fake` routes. `npm run demo` starts the same installation for a manual look (it needs `npm ci` in the repository root too). The sign-in details are printed on start.

Run `npx playwright install chromium` once before browser tests. On Windows, run Vitest from a working directory with an upper-case drive letter (`C:\…`); a lower-case one loads Vitest twice and every suite fails with "failed to find the current suite".

## Structure

| Path                              | Responsibility                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/api/`                    | Typed client generated from the OpenAPI contract, the browser-write header, session-expiry detection, `ApiError`.                                                                                 |
| `src/lib/session/`                | `Session` state (depends on the `AuthService` interface), sign-in, re-authentication and password dialogs.                                                                                        |
| `src/lib/query/`                  | TanStack Query defaults: retry only transient failures, poll every 10 s, pause while hidden.                                                                                                      |
| `src/lib/<feature>/`              | Query factories and pure view logic per area, for example `system/readiness.ts` and `deployments/status-path.ts`.                                                                                 |
| `src/lib/deployments/`            | The deployment list and detail: conditions and filters (`view.ts`), preview-then-apply lifecycle (`lifecycle.ts`), the settings form (`settings-form.ts`) and staging (`stage.ts`).               |
| `src/lib/catalog/`                | Published and retained releases, the release page's inputs, downloads, local imports, source builds, removal, staging and form validation (`validation.ts`).                                      |
| `src/lib/operations/`             | Background downloads and builds for Activity and the catalog, polled quickly only while one runs.                                                                                                 |
| `src/lib/site/`, `src/lib/users/` | Nomad and VideoIPath settings (mirroring the manager's address rules) and local accounts.                                                                                                         |
| `src/lib/shell/`                  | Top bar, navigation (route IDs, role filtering, a sheet on narrow screens), command palette (`Ctrl K`, also devices and releases), theme and account menus, and notices carried to the next page. |
| `src/lib/ui/`                     | Design system: tokens (`styles/tokens.css`), base styles and components built on Bits UI primitives.                                                                                              |
| `src/lib/theme/`, `src/lib/time/` | Theme preference and the shared clock behind "Updated 4 s ago".                                                                                                                                   |
| `src/routes/`                     | Pages only; the root layout is the composition root that creates and provides every service.                                                                                                      |
| `messages/en.json`                | Every user-facing string (Paraglide). Add a locale file and list it in `project.inlang/settings.json` to translate.                                                                               |

State lives in rune-based classes and TanStack queries; components read fields and call methods, so only the parts of the page that depend on a changed value update.

## Design

The "Slate" direction: cool neutrals, teal accent, soft card surfaces, Hanken Grotesk with DM Mono for identifiers, light and dark themes from one set of `light-dark()` tokens. Status uses blue for verified and orange for failed (they differ in lightness, not only hue) and always pairs colour with shape and text. The four-part status path shows requested state, allocation, control and approval; approval lives in VideoIPath and is never shown as verified.

Lifecycle changes are planned before they are applied. Start, stop, update and rollback first ask Nomad for a dry-run plan, which shows the version, requested state, pinned image and placement. Applying resubmits with the revision the operator reviewed. A concurrent change is reported for review instead of being overwritten. A submission without a definite answer asks the operator to reload before trying again, because it may have been applied. Viewers see the same plans but cannot apply them.
